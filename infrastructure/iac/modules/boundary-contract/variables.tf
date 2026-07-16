variable "name" {
  description = "Stable architecture-plane name."
  type        = string

  validation {
    condition     = can(regex("^[a-z][a-z0-9-]+$", var.name))
    error_message = "Boundary names use lowercase kebab-case."
  }
}

variable "accepts_from" {
  description = "Named callers allowed to enter this plane."
  type        = set(string)
}

variable "may_call" {
  description = "Named planes this plane may call directly."
  type        = set(string)
}

variable "public_ingress" {
  description = "Whether the plane may receive public traffic."
  type        = bool
}

variable "stores_canonical_data" {
  description = "Whether the plane owns durable canonical records."
  type        = bool
}
