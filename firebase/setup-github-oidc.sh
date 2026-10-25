#!/usr/bin/env bash
# One-time keyless authentication for the Techware GitHub Actions Firestore-only workflow.
# Run in Google Cloud Shell while signed in as techwareacademy@gmail.com.
set -euo pipefail

PROJECT="techware-instructor"
EXPECTED_ACCOUNT="techwareacademy@gmail.com"
REPOSITORY="salah9604/techware-academy-platform"
POOL="techware-gha"
PROVIDER="github-main"
SA_ID="techware-rules-deployer"
SA="${SA_ID}@${PROJECT}.iam.gserviceaccount.com"

ACTIVE_ACCOUNT="$(gcloud auth list --filter='status:ACTIVE' --format='value(account)' | head -n 1)"
if [[ "$ACTIVE_ACCOUNT" != "$EXPECTED_ACCOUNT" ]]; then
  echo "ERROR: Google Cloud Shell must use $EXPECTED_ACCOUNT (currently: ${ACTIVE_ACCOUNT:-none})." >&2
  exit 1
fi

PROJECT_NUMBER="$(gcloud projects describe "$PROJECT" --format='value(projectNumber)')"
if [[ "$PROJECT_NUMBER" != "257053522854" ]]; then
  echo "ERROR: Unexpected project number $PROJECT_NUMBER. No changes made." >&2
  exit 1
fi

echo "Configuring a restricted GitHub OIDC identity for $PROJECT..."
gcloud services enable iam.googleapis.com iamcredentials.googleapis.com sts.googleapis.com --project="$PROJECT"

if ! gcloud iam service-accounts describe "$SA" --project="$PROJECT" >/dev/null 2>&1; then
  gcloud iam service-accounts create "$SA_ID" --project="$PROJECT" --display-name="Techware Firestore Rules Deployment"
fi

if ! gcloud iam workload-identity-pools describe "$POOL" --project="$PROJECT" --location=global >/dev/null 2>&1; then
  gcloud iam workload-identity-pools create "$POOL" --project="$PROJECT" --location=global --display-name="Techware GitHub Actions"
fi

if ! gcloud iam workload-identity-pools providers describe "$PROVIDER" --project="$PROJECT" --location=global --workload-identity-pool="$POOL" >/dev/null 2>&1; then
  gcloud iam workload-identity-pools providers create-oidc "$PROVIDER" \
    --project="$PROJECT" --location=global --workload-identity-pool="$POOL" \
    --display-name="Techware repository main only" \
    --issuer-uri="https://token.actions.githubusercontent.com" \
    --attribute-mapping="google.subject=assertion.sub,attribute.repository=assertion.repository" \
    --attribute-condition="assertion.repository=='$REPOSITORY' && assertion.ref=='refs/heads/main'"
fi

POOL_RESOURCE="projects/${PROJECT_NUMBER}/locations/global/workloadIdentityPools/${POOL}"
gcloud iam service-accounts add-iam-policy-binding "$SA" --project="$PROJECT" \
  --role="roles/iam.workloadIdentityUser" \
  --member="principalSet://iam.googleapis.com/${POOL_RESOURCE}/attribute.repository/${REPOSITORY}"

gcloud projects add-iam-policy-binding "$PROJECT" \
  --member="serviceAccount:$SA" --role="roles/firebaserules.admin" --quiet
gcloud projects add-iam-policy-binding "$PROJECT" \
  --member="serviceAccount:$SA" --role="roles/firebase.viewer" --quiet

echo "Ready. In GitHub Actions, run 'Deploy Techware Firestore Rules' from main."
echo "Confirm project: techware-instructor"
echo "This setup does not deploy or alter Firestore rules or database records."
