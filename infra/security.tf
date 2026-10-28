
resource "aws_security_group" "web" {
  name        = "${var.project}-web-sg"
  description = "nginx: HTTP and SSH from my IP"
  vpc_id      = aws_vpc.app.id
  tags        = { Name = "${var.project}-web-sg" }
}

resource "aws_vpc_security_group_ingress_rule" "web_ssh" {
  security_group_id = aws_security_group.web.id
  description       = "SSH from my IP"
  cidr_ipv4         = var.my_ip
  ip_protocol       = "tcp"
  from_port         = 22
  to_port           = 22
}

resource "aws_vpc_security_group_ingress_rule" "web_http" {
  security_group_id = aws_security_group.web.id
  description       = "HTTP from my IP"
  cidr_ipv4         = var.my_ip
  ip_protocol       = "tcp"
  from_port         = 80
  to_port           = 80
}

resource "aws_vpc_security_group_egress_rule" "web_all_out" {
  security_group_id = aws_security_group.web.id
  description       = "All outbound"
  cidr_ipv4         = "0.0.0.0/0"
  ip_protocol       = "-1"
}


resource "aws_security_group" "nat" {
  name        = "${var.project}-nat-sg"
  description = "NAT instance: forward traffic from the backend subnet"
  vpc_id      = aws_vpc.app.id
  tags        = { Name = "${var.project}-nat-sg" }
}

resource "aws_vpc_security_group_ingress_rule" "nat_from_backend" {
  security_group_id = aws_security_group.nat.id
  description       = "Everything from the backend subnet (to be NATed)"
  cidr_ipv4         = aws_subnet.backend.cidr_block
  ip_protocol       = "-1"
}

resource "aws_vpc_security_group_egress_rule" "nat_all_out" {
  security_group_id = aws_security_group.nat.id
  description       = "All outbound (to the internet)"
  cidr_ipv4         = "0.0.0.0/0"
  ip_protocol       = "-1"
}


resource "aws_security_group" "backend" {
  name        = "${var.project}-backend-sg"
  description = "FastAPI: API and SSH from the web server only"
  vpc_id      = aws_vpc.app.id
  tags        = { Name = "${var.project}-backend-sg" }
}

resource "aws_vpc_security_group_ingress_rule" "backend_api_from_web" {
  security_group_id            = aws_security_group.backend.id
  description                  = "API from nginx"
  referenced_security_group_id = aws_security_group.web.id
  ip_protocol                  = "tcp"
  from_port                    = 8000
  to_port                      = 8000
}

resource "aws_vpc_security_group_ingress_rule" "backend_ssh_from_web" {
  security_group_id            = aws_security_group.backend.id
  description                  = "SSH via the web server (bastion)"
  referenced_security_group_id = aws_security_group.web.id
  ip_protocol                  = "tcp"
  from_port                    = 22
  to_port                      = 22
}

resource "aws_vpc_security_group_egress_rule" "backend_all_out" {
  security_group_id = aws_security_group.backend.id
  description       = "All outbound (NAT to internet, RDS over peering)"
  cidr_ipv4         = "0.0.0.0/0"
  ip_protocol       = "-1"
}


resource "aws_security_group" "db" {
  name        = "${var.project}-db-sg"
  description = "RDS: MariaDB from the backend subnet over peering"
  vpc_id      = aws_vpc.db.id
  tags        = { Name = "${var.project}-db-sg" }
}

resource "aws_vpc_security_group_ingress_rule" "db_from_backend" {
  security_group_id = aws_security_group.db.id
  description       = "MariaDB from the backend subnet (App VPC, via peering)"
  cidr_ipv4         = aws_subnet.backend.cidr_block
  ip_protocol       = "tcp"
  from_port         = 3306
  to_port           = 3306
}