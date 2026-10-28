# Task Planner on AWS: Infrastructure & Architecture

As of 2026-10-28 · Terraform code in [`infra/`](../infra/)

## Contents

1. [Overview](#overview)
2. [Architecture and address plan](#architecture-and-address-plan)
3. [Networking](#networking)
4. [Security](#security)
5. [Compute and data](#compute-and-data)
6. [Terraform layout](#terraform-layout)
7. [Review of the step-by-step guide](#review-of-the-step-by-step-guide)
8. [Infra review: risks and improvements](#infra-review-risks-and-improvements)
9. [Costs and teardown](#costs-and-teardown)

---

## Overview

The task planner (React + FastAPI + MariaDB) runs in `us-east-1` across two VPCs joined by peering,
built by 46 Terraform resources in `infra/`. The setup is sound and matches the guide's design; the
review below found one bug that breaks the guide's checks (tag key case), one broken SSH step, and a
few drift and least-privilege items.

**What is deployed**

- **App VPC** `10.10.0.0/16`: a public frontend subnet with `web` (nginx) and `nat` (NAT instance),
  and a private backend subnet with `backend-1` and `backend-2` (FastAPI on port 8000).
- **DB VPC** `10.30.0.0/16`: two private subnets in two AZs holding one RDS MariaDB 11.4 instance.
  No internet gateway.
- **VPC peering** `tasks-app-to-db`, routed only between the backend subnet and the DB VPC.
- **SSM Parameter Store** under `/tasks/db/` for the DB endpoint and passwords, read by the backends
  through an IAM role.

**Why two VPCs:** the database sits in a network with no gateway at all, so it cannot reach or be
reached from the internet even if a security group is wrong. Peering plus narrow routes are the only
way in.

**One request, end to end**

1. The browser (from `my_ip` only) calls `http://<web public IP>/`; nginx returns the React build.
2. The page calls `/api/v1/tasks` on the same host (empty `VITE_API_URL`, so no CORS).
3. nginx load-balances `/api` to `backend-1:8000` or `backend-2:8000` inside the App VPC.
4. The backend reads the DB endpoint and app password from SSM (via NAT to the SSM public endpoint),
   then connects to RDS on 3306 over the peering.
5. RDS replies via the DB route `10.10.2.0/24 → pcx`; the backend answers nginx; nginx answers the
   browser.

## Architecture and address plan

Traffic enters only at web; backends leave only through the NAT; the database is reachable only from
the backend subnet across the peering.

```
                Internet · your browser (my_ip)
          │                                    ▲
          │ HTTP :80, SSH :22 (IGW)            │ egress (IGW)
┌─────────┼────────────────────────────────────┼─────────────────────┐
│         │ App VPC 10.10.0.0/16               │                     │
│ ┌───────┼────────────────────────────────────┼───────────────────┐ │
│ │       │ frontend 10.10.1.0/24 · public     │                   │ │
│ │  ┌────▼──────────────────┐    ┌────────────┴──────────────┐    │ │
│ │  │ web · nginx           │    │ nat · NAT instance        │    │ │
│ │  │ React + /api proxy    │    │ MASQUERADE, src/dst off   │    │ │
│ │  └────┬──────────────────┘    └────────────▲──────────────┘    │ │
│ └───────┼────────────────────────────────────┼───────────────────┘ │
│         │ /api :8000, SSH :22                │ 0.0.0.0/0           │
│ ┌───────┼────────────────────────────────────┼───────────────────┐ │
│ │       │ backend 10.10.2.0/24 · private     │                   │ │
│ │       ├───────────────────────────────┐    │                   │ │
│ │  ┌────▼────────────────┐   ┌──────────▼────┴─────┐             │ │
│ │  │ backend-1 · FastAPI │   │ backend-2 · FastAPI │             │ │
│ │  │ :8000, SSM via role │   │ :8000, SSM via role │             │ │
│ │  └──────────┬──────────┘   └──────────┬──────────┘             │ │
│ │             └─────────────┬───────────┘                        │ │
│ │                           │                                    │ │
│ └───────────────────────────┼────────────────────────────────────┘ │
└─────────────────────────────┼──────────────────────────────────────┘
                              │ VPC peering (pcx) · TCP 3306
┌─────────────────────────────┼──────────────────────────────────────┐
│                             │ DB VPC 10.30.0.0/16 · no IGW         │
│              ┌──────────────▼────────────┐                         │
│              │ RDS MariaDB 11.4          │  db-a 10.30.1.0/24 AZ a │
│              │ 3306 from 10.10.2.0/24    │  db-b 10.30.2.0/24 AZ b │
│              └───────────────────────────┘                         │
└────────────────────────────────────────────────────────────────────┘
```

| Network | CIDR | AZ | Holds |
| --- | --- | --- | --- |
| App VPC | `10.10.0.0/16` | | |
| frontend subnet (public) | `10.10.1.0/24` | a | web, nat |
| backend subnet (private) | `10.10.2.0/24` | a | backend-1, backend-2 |
| DB VPC | `10.30.0.0/16` | | |
| db-a (private) | `10.30.1.0/24` | a | RDS |
| db-b (private) | `10.30.2.0/24` | b | RDS subnet group only |

## Networking

Three route tables decide every path; only the backend table reaches both the internet (via NAT) and
the database (via peering).

| Route table | Subnets | Routes | Effect |
| --- | --- | --- | --- |
| `tasks-frontend-rt` | frontend `10.10.1.0/24` | local, `0.0.0.0/0 → igw` | web and nat reach the internet; no route to `10.30.x` |
| `tasks-backend-rt` | backend `10.10.2.0/24` | local, `10.30.0.0/16 → pcx`, `0.0.0.0/0 → nat ENI` | backends reach RDS and the internet, never directly from it |
| `tasks-db-rt` | db-a `10.30.1.0/24`, db-b `10.30.2.0/24` | local, `10.10.2.0/24 → pcx` | RDS can reply only to the backend subnet |

**VPC peering** ([`peering.tf`](../infra/peering.tf)): same account and region, so
`auto_accept = true` makes it active at once. The CIDRs do not overlap. Peering is not transitive and
the DB VPC cannot borrow the App VPC's IGW or NAT.

**NAT instance** ([`nat.tf`](../infra/nat.tf), [`nat_user_data.sh.tftpl`](../infra/nat_user_data.sh.tftpl)):
an Ubuntu 24.04 EC2 in the frontend subnet with `source_dest_check = false`. Its first-boot script
sets `net.ipv4.ip_forward = 1`, adds an `iptables` MASQUERADE rule for `10.10.2.0/24` on the default
interface, allows forwarded traffic out and only replies back in, and saves the rules with
`iptables-persistent`. The backend default route points at its primary network interface.

**Subnet math:** every subnet is computed from the two VPC variables with `cidrsubnet(cidr, 8, n)`,
so the address plan lives in [`variables.tf`](../infra/variables.tf) only. All App subnets and db-a
sit in the first AZ; db-b exists because an RDS subnet group needs two AZs.

## Security

Every path needs both a route and a security group rule; the database is protected by three
independent layers (no gateway, narrow routes, a 3306-only SG).

| Security group | VPC | Inbound | Outbound |
| --- | --- | --- | --- |
| `tasks-web-sg` | App | 22, 80 from `my_ip` | all |
| `tasks-nat-sg` | App | all from `10.10.2.0/24` | all |
| `tasks-backend-sg` | App | 8000, 22 from `tasks-web-sg` | all |
| `tasks-db-sg` | DB | 3306 from `10.10.2.0/24` | none (stateful replies only) |

The DB rule uses a CIDR, not an SG reference, because the backend SG lives in the other VPC.

| From → to | Allowed | Why |
| --- | --- | --- |
| your IP → web :80, :22 | yes | web SG |
| web → backends :8000, :22 | yes | backend SG references web SG |
| backends → internet | yes | default route to NAT + MASQUERADE |
| backends → RDS :3306 | yes | peering routes both sides + db SG |
| web → RDS | no | frontend route table has no `10.30.x` route |
| internet → backends | no | private IPs only |
| internet ↔ RDS | no | no IGW in DB VPC, `publicly_accessible = false` |

**Identity and secrets**

- `tasks-backend-role` (instance profile on both backends only) allows `ssm:GetParameter*` on
  `/tasks/*`. `web` and `nat` have no role.
- Passwords come from `random_password` (24 chars, no specials) and are stored as `SecureString`
  under `/tasks/db/`. They are also in the S3 state file, so the bucket must stay private, encrypted
  and versioned.
- All instances enforce IMDSv2 (`http_tokens = "required"`) and use encrypted gp3 root volumes; RDS
  storage is encrypted.
- SSH reaches the backends only through `web` as a bastion (`ProxyJump`); the private key never
  leaves the Mac.

## Compute and data

Four EC2 instances and one RDS instance, all EC2s from the latest Ubuntu 24.04 amd64 AMI (read from
Canonical's public SSM parameter, then pinned by `ignore_changes = [ami]`).

| Name | Type | Subnet | Public IP | Disk | Role | Boot script |
| --- | --- | --- | --- | --- | --- | --- |
| `tasks-web` | t3.micro | frontend | yes | 20 GB gp3 | none | `server_user_data.sh` |
| `tasks-backend-1`, `-2` | t3.micro (`count = 2`) | backend | no | 20 GB gp3 | backend | `server_user_data.sh` |
| `tasks-nat` | t3.micro | frontend | yes | 8 GB gp3 | none | `nat_user_data.sh.tftpl` |
| `tasks-db` (RDS) | db.t4g.micro, MariaDB 11.4 | db-a / db-b group | no | 20 GB gp3 | n/a | n/a |

**App server boot script** ([`server_user_data.sh`](../infra/server_user_data.sh), plain `file()`):
adds 1 GB swap, installs git, jq, mariadb-client and netcat, Docker CE with the compose plugin, and
the AWS CLI snap, then writes `/var/tmp/user-data-done`. On the backends it needs internet at once,
so `depends_on = [aws_route.backend_default]` makes Terraform create the NAT route first.

**RDS:** database `tasks`, admin user `dbadmin`, single-AZ, 1 day of backups,
`skip_final_snapshot = true` and no deletion protection so `terraform destroy` removes it cleanly.
The app user and its grants are not created by Terraform; Step 9 has to create them with the master
password.

**SSH access:** `terraform output -raw ssh_config` renders a config with `tasks-web` and
`tasks-backend-N` (the latter with `ProxyJump tasks-web`), saved to `~/.ssh/config.d-tasks` and
pulled in by an `Include` line. Public and private IPs change on every rebuild, so the file must be
regenerated.

## Terraform layout

One root module in `infra/`, state in S3 (`tutorials-tfstate-<account>`, key
`tasks-2vpc/terraform.tfstate`, native lockfile), AWS provider `~> 6.0`, Terraform `>= 1.10`.
Resource counts below were checked against the code and add up to the guide's 46.

| File | Holds | Resources | Guide step |
| --- | --- | --- | --- |
| `versions.tf` | Terraform + provider versions, S3 backend | 0 | 1 |
| `providers.tf` | AWS provider, `default_tags` | 0 | 1 |
| `variables.tf` | `project`, `region`, `my_ip` (validated /32), `ssh_public_key_path`, two VPC CIDRs | 0 | 1 |
| `networks.tf` | AZ lookup, App VPC, IGW, 2 subnets, 2 route tables + associations | 8 | 2 |
| `network-db.tf` | DB VPC, 2 subnets, route table + 2 associations | 6 | 3 |
| `peering.tf` | peering connection, 2 routes | 3 | 4 |
| `security.tf` | 4 security groups, 9 rules | 13 | 5 |
| `compute-common.tf` | AMI lookup, key pair; backend IAM role, policy, instance profile | 1 + 3 | 6, 8 |
| `nat.tf` + `nat_user_data.sh.tftpl` | NAT instance, backend default route | 2 | 6 |
| `database.tf` | 2 passwords, subnet group, RDS, 3 SSM parameters | 7 | 7 |
| `servers.tf` + `server_user_data.sh` | web, 2 backends | 3 | 8 |
| `outputs.tf` | IPs, DB endpoint, rendered `ssh_config` | 0 | 6–8 |

`terraform.tfvars` holds only `my_ip` and is gitignored; `.terraform.lock.hcl` is committed.

## Review of the step-by-step guide

The guide's design, address plan, resource counts (8 + 6 + 3 + 13 + 3 + 7 + 6 = 46) and explanations
are correct. The items below are wrong or out of step with the code, ordered by impact. Steps 8.7 to
10 were not reviewed.

| # | Where | Problem | Fix |
| --- | --- | --- | --- |
| 1 | Step 1 `providers.tf` vs code | Code tags are `project` / `managedBy` (lowercase); the guide and every `--filters "Name=tag:Project,Values=tasks"` check use `Project`. Tag keys are case-sensitive, so the Step 2, 3 and 5 checks return nothing. | Change the code to `Project` and `ManagedBy` (re-tags in place, no rebuild), or lowercase the filters. |
| 2 | Step 8.6 `sed -i '' '1i\'` | After `touch` creates an empty `~/.ssh/config`, `sed` has no line 1, so the `Include` is never added and `ssh tasks-web` fails. | See the snippet below. |
| 3 | Step 8.4 `ssh_config` output | Tested: neither the committed nor the uncommitted `%{~for}` variant puts the lines at the left edge; the current one indents everything 4 spaces and adds blank lines. SSH still parses it, but the guide's check fails. | See the snippet below (verified to render clean). |
| 4 | Step 6.3 `instance_type` | Guide says `t3.nano`; `nat.tf` uses `t3.micro`. Cost note (≈ $0.25/day) assumes nano. | Pick one; nano is enough for NAT at this scale. |
| 5 | Step 2 file name | Guide writes `network-app.tf`; repo has `networks.tf`. | Rename the file or the guide. |
| 6 | Step 0.4 `.gitignore` | `cat >>` is not idempotent; the repo `.gitignore` now has the Terraform block twice. | Delete the duplicate block; say "add if missing". |
| 7 | Step 8 cost total | ≈ $1.60/day leaves out EBS (68 GB gp3 ≈ $0.18/day) and the NAT's public IPv4 ($0.12/day). | Count them: ≈ $1.80/day with nano, ≈ $1.90 with micro (approximate). |
| 8 | Code comments and typos | `peering.tf` says `//10.10.2.0 / 16` (it is /24); `variables.tf` error says "mush". | Fix the text. |
| 9 | Steps 4–6 `terraform state show \| awk` | Fragile when output is coloured. | Add `-no-color`, or add the IDs as outputs and use `terraform output -raw`. |

**Fix for #2**, works on an empty or missing config:

```bash
touch ~/.ssh/config
grep -qxF 'Include ~/.ssh/config.d-tasks' ~/.ssh/config || {
  printf 'Include ~/.ssh/config.d-tasks\n\n' | cat - ~/.ssh/config > ~/.ssh/config.tmp &&
  mv ~/.ssh/config.tmp ~/.ssh/config
}
```

**Fix for #3**, a plain heredoc with the text at column 0:

```hcl
output "ssh_config" {
  value = <<EOT
Host tasks-web
  HostName ${aws_instance.web.public_ip}
  User ubuntu
  IdentityFile ~/.ssh/tasks-key
%{ for i, b in aws_instance.backend ~}
Host tasks-backend-${i + 1}
  HostName ${b.private_ip}
  User ubuntu
  IdentityFile ~/.ssh/tasks-key
  ProxyJump tasks-web
%{ endfor ~}
EOT
}
```

## Infra review: risks and improvements

Fine for a practice project; nothing is exposed beyond `my_ip`. These are the changes worth making
before reusing the setup elsewhere.

| Priority | Finding | Recommendation |
| --- | --- | --- |
| High | Backend role can read `/tasks/db/master_password`, not just what the app needs. | Scope the policy to `/tasks/db/endpoint` and `/tasks/db/app_password`; read the master password from the Mac only. |
| Medium | Single AZ for web, NAT and both backends; the NAT instance is a single point of failure and unpatched by AWS. | Accept for practice; for production use 2 AZs and a NAT Gateway (or one per AZ). |
| Medium | HTTP only on port 80; web public IP changes on every stop/start. | Add an Elastic IP and TLS (ACM + ALB, or certbot on nginx) if it ever opens beyond `my_ip`. |
| Low | `server_user_data.sh` hardcodes `AWS_DEFAULT_REGION=us-east-1`, ignoring `var.region`. | Switch to `templatefile()` and pass `region` (escape shell vars as `$${...}`). |
| Low | `web` installs the AWS CLI and mariadb-client it never uses. | Optional: a lighter web script. |
| Low | `web` and backends use plain `user_data` without `user_data_replace_on_change`, so editing the script changes nothing on running servers. | Add it, or document that a script change needs `terraform apply -replace`. |
| Info | Passwords sit in S3 state in plain text. | Keep the bucket private, encrypted, versioned; or use `manage_master_user_password = true` on RDS. |

## Costs and teardown

The running stack costs about $1.90 per day as coded (approximate us-east-1 on-demand prices).

| Item | Approx. per day |
| --- | --- |
| NAT t3.micro + public IPv4 | $0.37 |
| web + 2 backends (3 × t3.micro) + web public IPv4 | $0.87 |
| RDS db.t4g.micro + 20 GB gp3 | $0.46 |
| EBS gp3 (3 × 20 GB + 8 GB) | $0.18 |
| Peering traffic | ≈ $0.01/GB |

- **Pause:** `aws rds stop-db-instance --db-instance-identifier tasks-db` (restarts by itself after
  7 days) and `aws ec2 stop-instances` for the EC2s. EBS charges continue while stopped;
  auto-assigned public IPs are released and change on start, so regenerate the SSH config.
- **Remove:** `terraform destroy` in `infra/` deletes all 46 resources; RDS has no final snapshot and
  no deletion protection. The S3 state bucket is outside this config and stays.
