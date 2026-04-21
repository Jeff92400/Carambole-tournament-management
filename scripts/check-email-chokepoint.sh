#!/usr/bin/env bash
#
# Guard rail: the sendEmail() chokepoint in backend/utils/email-helpers.js is
# the ONLY place allowed to call `resend.emails.send(...)` or instantiate
# `new Resend(process.env.RESEND_API_KEY)`. Any drift means the per-org test
# mode kill-switch and the email_test_mode_log audit trail will leak.
#
# This script scans the codebase for violations and exits non-zero if any
# are found. Intended to be run:
#   - locally (pre-push)
#   - by any CI/deploy hook once we wire one up
#
# Usage:
#   ./scripts/check-email-chokepoint.sh
#
# To fix a failure: route the offending send through
# `sendEmail(payload, { recipientKind: 'player' | 'admin', orgId, ... })`
# imported from `backend/utils/email-helpers.js`.

set -eu
cd "$(dirname "$0")/.."

ALLOWED_FILE="backend/utils/email-helpers.js"

# Find raw Resend SDK usage outside the allowed file.
VIOLATIONS=$(
  grep -rn --include='*.js' \
    -E "resend\.emails\.send\(|new Resend\(process\.env" \
    backend \
  | grep -v "^$ALLOWED_FILE:" \
  || true
)

if [ -n "$VIOLATIONS" ]; then
  echo "❌ Email chokepoint violation detected:"
  echo
  echo "$VIOLATIONS"
  echo
  echo "Every outgoing email MUST go through sendEmail() in $ALLOWED_FILE."
  echo "Per-org test mode and email_test_mode_log depend on this."
  exit 1
fi

echo "✓ Email chokepoint is clean — all Resend calls go through sendEmail()."
