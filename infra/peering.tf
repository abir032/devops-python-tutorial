
resource "aws_vpc_peering_connection" "app_db" {
  vpc_id      = aws_vpc.app.id // requestor
  peer_vpc_id = aws_vpc.db.id  // acceptor
  auto_accept = true

  tags = {
    Name = "${var.project}-app-to-db"
  }
}


resource "aws_route" "backend_to_db" {
  route_table_id            = aws_route_table.backend.id
  destination_cidr_block    = var.db_vpc_cidr //10.30.0.0 / 16
  vpc_peering_connection_id = aws_vpc_peering_connection.app_db.id
}


resource "aws_route" "db_to_backend" {
  route_table_id            = aws_route_table.db.id
  destination_cidr_block    = aws_subnet.backend.cidr_block //10.10.2.0 / 16
  vpc_peering_connection_id = aws_vpc_peering_connection.app_db.id
}


