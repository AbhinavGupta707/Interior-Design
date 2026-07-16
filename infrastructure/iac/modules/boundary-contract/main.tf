locals {
  contract = {
    accepts_from          = sort(tolist(var.accepts_from))
    may_call              = sort(tolist(var.may_call))
    name                  = var.name
    public_ingress        = var.public_ingress
    stores_canonical_data = var.stores_canonical_data
  }
}

check "canonical_data_is_not_public" {
  assert {
    condition     = !(var.public_ingress && var.stores_canonical_data)
    error_message = "A public plane cannot own canonical data."
  }
}
