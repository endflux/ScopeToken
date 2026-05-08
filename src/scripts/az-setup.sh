#!/usr/bin/env bash
set -euo pipefail

# One-time Azure prep for new operators of this project.
# Registers the resource providers that phish.sh needs to actually deliver alerts.
# Safe to re-run — checks current state before doing anything.

REQUIRED_PROVIDERS=(
  Microsoft.Insights         # Action groups + activity log alerts
  Microsoft.AlertsManagement # Alert processing + email delivery
  Microsoft.Resources        # Resource groups + tags (default, but verified)
)

echo "Verifying az login..."
if ! az account show >/dev/null 2>&1; then
  echo "Not logged in. Run: az login"
  exit 1
fi

CURRENT_TENANT=$(az account show --query tenantId -o tsv)
CURRENT_SUB=$(az account show --query id -o tsv)
CURRENT_USER=$(az account show --query user.name -o tsv)

echo "  Tenant       : $CURRENT_TENANT"
echo "  Subscription : $CURRENT_SUB"
echo "  Signed in as : $CURRENT_USER"

if [[ "$CURRENT_TENANT" == "$CURRENT_SUB" ]]; then
  echo
  echo "Current az context is tenant-level (no subscription). You need a real subscription."
  echo "  az login                              # interactive, picks a subscription"
  echo "  az account list -o table              # see available subscriptions"
  echo "  az account set --subscription <id>    # switch to a real subscription"
  exit 1
fi

echo
echo "Checking RBAC on subscription..."
MY_OID=$(az ad signed-in-user show --query id -o tsv)
ROLE_COUNT=$(az role assignment list --assignee "$MY_OID" --scope "/subscriptions/$CURRENT_SUB" --query "length([?properties.roleDefinitionName=='Owner' || properties.roleDefinitionName=='Contributor'])" -o tsv 2>/dev/null || echo 0)
if [[ "$ROLE_COUNT" -lt 1 ]]; then
  echo "  WARNING: signed-in user has no Owner/Contributor role on this subscription."
  echo "  phish.sh will likely fail with Unauthorized errors."
  echo "  Grant yourself Owner with:"
  echo "    az role assignment create --assignee $MY_OID --role Owner --scope /subscriptions/$CURRENT_SUB"
else
  echo "  RBAC ok (Owner/Contributor)."
fi

echo
echo "Registering required resource providers..."
for ns in "${REQUIRED_PROVIDERS[@]}"; do
  state=$(az provider show --namespace "$ns" --query registrationState -o tsv)
  case "$state" in
    Registered)
      echo "  $ns: Registered"
      ;;
    Registering)
      echo "  $ns: already Registering"
      ;;
    *)
      echo "  $ns: $state → registering..."
      az provider register --namespace "$ns" >/dev/null
      ;;
  esac
done

echo
echo "Waiting for all providers to reach Registered (can take several minutes)..."
for ns in "${REQUIRED_PROVIDERS[@]}"; do
  while :; do
    state=$(az provider show --namespace "$ns" --query registrationState -o tsv)
    if [[ "$state" == "Registered" ]]; then
      echo "  $ns: Registered ✓"
      break
    fi
    printf "  %s: %s ... waiting\r" "$ns" "$state"
    sleep 15
  done
done

echo
echo "Azure setup complete. You can now run: npm run go:phish -- <target-email>"
