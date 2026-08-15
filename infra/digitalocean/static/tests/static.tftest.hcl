mock_provider "digitalocean" {}

variables {
  project_slug     = "example-product"
  project_id       = "project-id"
  app_region       = "fra"
  api_domain       = "api.example.com"
  webapp_domain    = "app.example.com"
  website_domain   = "www.example.com"
  dns_zone         = null
  github_repo      = "owner/repository"
  source_branch    = "infra-release/0123456789abcdef0123456789abcdef01234567"
  release_revision = "0123456789abcdef0123456789abcdef01234567"
}

run "static_uses_immutable_release_branch" {
  command = plan

  assert {
    condition = (
      digitalocean_app.webapp.spec[0].static_site[0].github[0].branch == var.source_branch &&
      digitalocean_app.website.spec[0].static_site[0].github[0].branch == var.source_branch
    )
    error_message = "Both static apps must build the wrapper-owned immutable release branch."
  }

  assert {
    condition = (
      one([for env in digitalocean_app.webapp.spec[0].static_site[0].env : env.value if env.key == "RELEASE_REVISION"]) == var.release_revision &&
      one([for env in digitalocean_app.website.spec[0].static_site[0].env : env.value if env.key == "RELEASE_REVISION"]) == var.release_revision
    )
    error_message = "Both static deployments must carry the exact release commit."
  }
}
