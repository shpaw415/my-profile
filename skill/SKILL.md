# my-profile (integration skill)

The user's personal profile — identity, contact info, government IDs and
business numbers — stored in the key vault (durable copy, plus a local 0600
read mirror), served to you field by field
so you can fill tax forms, government forms and any document that needs the
user's personal details without asking every time.

**Language rule: always answer the user in their own language. Field names are
English API constants; translate them in your reply. Never hardcode a
language.**

## CLI: `ob-plugin-my-profile-profile`

Output is always one JSON line: `{"ok":true|false, ...}`. Exit codes:
0 ok · 2 usage/validation · 4 field not filled.

```sh
# what exists and what is filled (NEVER prints values)
ob-plugin-my-profile-profile list

# one field's value
ob-plugin-my-profile-profile get city
ob-plugin-my-profile-profile get full_name
ob-plugin-my-profile-profile get sin          # alias: nas
ob-plugin-my-profile-profile get postal_code  # alias: postal / zip
ob-plugin-my-profile-profile get gst_number   # alias: tps

# update one field (with the user's consent, or from the dashboard form)
ob-plugin-my-profile-profile set city "Québec"

# payment cards — metadata only (brand, last4, expiry, status), NEVER a full number
ob-plugin-my-profile-profile cards list [--status active|inactive]
ob-plugin-my-profile-profile cards active
ob-plugin-my-profile-profile cards add --type credit --brand visa --last4 1234 --label "perso" --expiry 2029-05
ob-plugin-my-profile-profile cards status 1234 inactive   # obsolete / deactivated by provider
ob-plugin-my-profile-profile cards update 1234 --label "nouveau nom" --expiry 2030-01
ob-plugin-my-profile-profile cards remove 1234

# is the confirmation policy on?  (settings.sensitive_require_confirmation)
ob-plugin-my-profile-profile policy
```

Fields:
- identity: `full_name`, `date_of_birth` (YYYY-MM-DD)
- contact: `address_line1`, `address_line2`, `city`, `province`,
  `postal_code`, `country`, `phone`, `email`, `work_email`
- government (**sensitive**): `sin` (nas), `ramq`, `driver_license`
- business: `business_name`, `neq`, `gst_number` (tps), `qst_number` (tvq)

## Payment cards — metadata only

`cards` manages the user's debit/credit cards with a status: `active` or
`inactive` (obsolete, replaced, or deactivated by the provider). The plugin
stores ONLY brand, last 4 digits, expiry, label and status — it refuses a
full card number or a CVV by design. Never try to work around that, never
write a full PAN anywhere. When a card is needed for a payment, tell the user
which card you would use (brand + last4 + status) and confirm; an `inactive`
card is not usable unless the user reactivates it first.

## Sensitive fields — hard rule

`sin`, `ramq` and `driver_license` are sensitive. **Always ask the user for
explicit confirmation before sending or writing one of these into any form,
document or third-party service** — unless `policy` returns
`sensitive_require_confirmation: false`, which only the user can set. When in
doubt, ask. Never paste a sensitive value into logs, summaries or chat unless
the user asked for that exact value.

## Rules

- Check `list` before `get`: if a needed field is not filled, ask the user for
  it (and offer `set` or the dashboard My Profile tab to store it for next
  time) instead of failing silently.
- Fetch only the fields a form actually needs — one `get` per field, no bulk
  dumps of the whole profile into context.
- Every `set` writes the local read mirror and the key vault together, so a
  `get` right after a `set` sees the new value immediately.
- If the profile is empty overall, point the user to the **My Profile** tab in
  the dashboard: one form fills everything, including sensitive fields that
  only they should type.
