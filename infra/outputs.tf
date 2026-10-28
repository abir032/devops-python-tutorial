output "nat_public_ip" { value = aws_instance.nat.public_ip }
output "nat_private_ip" { value = aws_instance.nat.private_ip }
output "db_endpoint" { value = aws_db_instance.main.address }