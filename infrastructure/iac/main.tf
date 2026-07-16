module "public_edge" {
  source = "./modules/boundary-contract"

  name                  = "public-edge"
  accepts_from          = ["loopback-development-client"]
  may_call              = ["application-plane"]
  public_ingress        = true
  stores_canonical_data = false
}

module "application_plane" {
  source = "./modules/boundary-contract"

  name                  = "application-plane"
  accepts_from          = ["public-edge", "native-client"]
  may_call              = ["control-plane", "data-plane"]
  public_ingress        = false
  stores_canonical_data = false
}

module "worker_plane" {
  source = "./modules/boundary-contract"

  name                  = "worker-plane"
  accepts_from          = ["control-plane"]
  may_call              = ["data-plane"]
  public_ingress        = false
  stores_canonical_data = false
}

module "control_plane" {
  source = "./modules/boundary-contract"

  name                  = "control-plane"
  accepts_from          = ["application-plane", "worker-plane"]
  may_call              = ["worker-plane"]
  public_ingress        = false
  stores_canonical_data = false
}

module "data_plane" {
  source = "./modules/boundary-contract"

  name                  = "data-plane"
  accepts_from          = ["application-plane", "worker-plane"]
  may_call              = []
  public_ingress        = false
  stores_canonical_data = true
}

locals {
  architecture_contract = {
    contract_version = "c0-v1"
    deployable       = var.deployment_enabled
    environment      = var.environment
    provider_mode    = var.provider_mode
    planes = {
      application = module.application_plane.contract
      control     = module.control_plane.contract
      data        = module.data_plane.contract
      public_edge = module.public_edge.contract
      worker      = module.worker_plane.contract
    }
    data_classes = sort(tolist(var.data_classes))
    invariants = [
      "canonical-mutations-are-authorised-and-audited",
      "source-evidence-is-immutable",
      "source-derived-issued-and-quarantine-storage-remain-distinct",
      "workers-have-no-broad-credentials",
      "public-ingress-cannot-reach-the-data-plane-directly",
      "provider-and-spend-activation-require-a-separate-decision",
    ]
  }
}

check "provider_and_spend_disabled" {
  assert {
    condition     = var.deployment_enabled == false && var.provider_mode == "disabled"
    error_message = "This C0 module may only describe non-deploying local infrastructure."
  }
}

check "only_edge_is_public" {
  assert {
    condition = alltrue([
      module.public_edge.contract.public_ingress,
      !module.application_plane.contract.public_ingress,
      !module.worker_plane.contract.public_ingress,
      !module.control_plane.contract.public_ingress,
      !module.data_plane.contract.public_ingress,
    ])
    error_message = "Only the public-edge contract may accept public ingress."
  }
}
