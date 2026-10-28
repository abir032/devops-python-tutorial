output "nat_public_ip" { value = aws_instance.nat.public_ip }
output "nat_private_ip" { value = aws_instance.nat.private_ip }
output "db_endpoint" { value = aws_db_instance.main.address }


output "web_public_ip" { value = aws_instance.web.public_ip }
output "web_private_ip" { value = aws_instance.web.private_ip }
output "backend_private_ips" { value = aws_instance.backend[*].private_ip }

output "ssh_config" {
  value = <<-EOT
    Host tasks-web
      HostName ${aws_instance.web.public_ip}
      User ubuntu
      IdentityFile ~/.ssh/tasks-key
   %{~for i, b in aws_instance.backend}
    Host tasks-backend-${i + 1}
      HostName ${b.private_ip}
      User ubuntu
      IdentityFile ~/.ssh/tasks-key
      ProxyJump tasks-web
    %{~endfor}
  EOT
}