variable "project" {
  description = "Name prefix for all resources"
  type        = string
  default     = "tasks"
}

variable "region" {
  description = "Aws Region"
  type        = string
  default     = "us-east-1"
}

variable "my_ip" {
  description = "your public ip as a /32"
  type        = string

  validation {
    condition     = can(cidrhost(var.my_ip, 0)) && endswith(var.my_ip, "/32")
    error_message = "my_ip mush be a single IPv4 address ending in /32"
  }
}

variable "ssh_public_key_path" {
  description = "Path to the SSH public key on this computer"
  type        = string
  default     = "~/.ssh/tasks-key.pub"
}

variable "db_vpc_cidr" {
  description = "DB VPC: RDS only. Must not overlap app_vpc_cidr (peering rule)"
  type        = string
  default     = "10.30.0.0/16"
}

variable "app_vpc_cidr" {
  description = "App VPC: frontend + backend subnets"
  type        = string
  default     = "10.10.0.0/16"
}



