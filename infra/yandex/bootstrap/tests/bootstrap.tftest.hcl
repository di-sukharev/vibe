mock_provider "yandex" {}

override_resource {
  target          = yandex_iam_service_account.terraform_state
  override_during = plan
  values          = { id = "state-service-account-id" }
}

override_resource {
  target          = yandex_iam_service_account_static_access_key.terraform_state
  override_during = plan
  values          = { access_key = "state-access-key" }
}

variables {
  cloud_id          = "cloud-test"
  folder_id         = "folder-test"
  project_slug      = "example-product"
  state_bucket_name = "example-product-terraform-state-test"
}

run "private_versioned_state" {
  command = plan

  assert {
    condition     = one(yandex_storage_bucket.terraform_state.anonymous_access_flags).read == false
    error_message = "Terraform state must not be publicly readable."
  }

  assert {
    condition     = one(yandex_storage_bucket.terraform_state.versioning).enabled
    error_message = "Terraform state must be versioned for recovery."
  }

  assert {
    condition     = yandex_storage_bucket.terraform_state.max_size == 1073741824
    error_message = "A state bucket needs a bounded launch-size quota."
  }

  assert {
    condition = (
      try(yandex_storage_bucket.terraform_state.lifecycle_rule[0].enabled, false) &&
      try(yandex_storage_bucket.terraform_state.lifecycle_rule[0].noncurrent_version_expiration[0].days, 0) == 30
    )
    error_message = "Every init, plan, and apply writes and deletes the lock object and every apply rewrites state; versioning keeps each as a noncurrent version, so the bucket needs one enabled rule expiring them after 30 days, the window the static buckets keep, or max_size eventually refuses the next lock."
  }

  assert {
    condition     = try(yandex_storage_bucket.terraform_state.lifecycle_rule[0].abort_incomplete_multipart_upload_days, 0) == 7
    error_message = "An interrupted multipart state write must be aborted instead of holding quota."
  }

  assert {
    condition     = try(yandex_storage_bucket.terraform_state.lifecycle_rule[1].enabled, null) == null
    error_message = "The state bucket keeps exactly one lifecycle rule; a second one is where an expiration of current versions would hide."
  }

  assert {
    condition     = try(length(yandex_storage_bucket.terraform_state.lifecycle_rule[0].expiration), 0) == 0
    error_message = "The lifecycle rule must leave current state versions alone."
  }

  assert {
    condition     = length(yandex_resourcemanager_folder_iam_member.terraform_state_storage) == 0
    error_message = "The temporary folder-wide bootstrap role must be absent from steady state."
  }

  assert {
    condition = (
      one([
        for statement in jsondecode(yandex_storage_bucket_policy.terraform_state.policy).Statement : statement
        if statement.Sid == "TerraformStateBucketConfiguration"
      ]).Principal.CanonicalUser == "state-service-account-id" &&
      one([
        for statement in jsondecode(yandex_storage_bucket_policy.terraform_state.policy).Statement : statement
        if statement.Sid == "TerraformStateBucketConfiguration"
      ]).Action == "s3:*" &&
      one([
        for statement in jsondecode(yandex_storage_bucket_policy.terraform_state.policy).Statement : statement
        if statement.Sid == "TerraformStateBucketConfiguration"
      ]).Resource == "arn:aws:s3:::${var.state_bucket_name}" &&
      toset(one([
        for statement in jsondecode(yandex_storage_bucket_policy.terraform_state.policy).Statement : statement
        if statement.Sid == "ProtectStateBucket"
      ]).Action) == toset(["s3:DeleteBucket", "s3:PutBucketVersioning"]) &&
      !strcontains(yandex_storage_bucket_policy.terraform_state.policy, "s3:DeleteObjectVersion")
    )
    error_message = "The dedicated state service account must support bucket refresh and credential recovery without bucket deletion, versioning changes, or version deletion."
  }

  assert {
    condition = (
      yandex_storage_bucket_policy.terraform_state.access_key == "state-access-key" &&
      strcontains(yandex_storage_bucket_policy.terraform_state.policy, "s3:GetObject") &&
      strcontains(yandex_storage_bucket_policy.terraform_state.policy, "s3:PutObject") &&
      strcontains(yandex_storage_bucket_policy.terraform_state.policy, "s3:DeleteObject")
    )
    error_message = "The Terraform-managed state key must apply and refresh its own policy and current state objects."
  }
}

run "temporary_first_apply_access" {
  command = plan

  variables {
    bootstrap_folder_storage_access = true
  }

  assert {
    condition     = length(yandex_resourcemanager_folder_iam_member.terraform_state_storage) == 1
    error_message = "The first local apply needs temporary access to create the state bucket."
  }

  assert {
    condition     = one(yandex_resourcemanager_folder_iam_member.terraform_state_storage).role == "storage.admin"
    error_message = "The temporary bootstrap role must be able to enable state-bucket versioning."
  }

  assert {
    condition     = strcontains(yandex_storage_bucket_policy.terraform_state.policy, "state-service-account-id")
    error_message = "The first apply must install the dedicated service-account policy before temporary access is removed."
  }
}
