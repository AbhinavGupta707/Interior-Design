variable "deployment_enabled" {
  description = "Hard safety switch. This provider-free contract must never deploy resources."
  type        = bool
  default     = false

  validation {
    condition     = var.deployment_enabled == false
    error_message = "The C0 infrastructure contract is non-deploying by design."
  }
}

variable "environment" {
  description = "Only the credential-free local environment exists in C0."
  type        = string
  default     = "local"

  validation {
    condition     = var.environment == "local"
    error_message = "C0 does not define staging or production infrastructure."
  }
}

variable "provider_mode" {
  description = "Cloud/provider activation is deliberately disabled."
  type        = string
  default     = "disabled"

  validation {
    condition     = var.provider_mode == "disabled"
    error_message = "A provider requires a separately accepted deployment decision."
  }
}

variable "data_classes" {
  description = "Storage lifecycle classes that must remain distinct in every implementation."
  type        = set(string)
  default     = ["source", "derived", "issued", "quarantine"]

  validation {
    condition = length(setsubtract(
      var.data_classes,
      toset(["source", "derived", "issued", "quarantine"]),
      )) == 0 && length(setsubtract(
      toset(["source", "derived", "issued", "quarantine"]),
      var.data_classes,
    )) == 0
    error_message = "Source, derived, issued, and quarantine classes are all mandatory."
  }
}
