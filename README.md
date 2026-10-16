# my-profile

Personal profile vault plugin for [open-bot](https://github.com/shpaw415): the user fills
their identity, contact information, government ID numbers, business numbers and payment
cards **once** — through a dashboard form — and the agent can then serve themselves field
by field when a tax form, government form or any document needs personal details, instead
of asking for the same information every time.

Works for any user, any country, any language: field names are English API constants and
the dashboard speaks French and English out of the box.

## Features

- **Dashboard tab "My Profile"** — one form with four groups (identity, contact,
  government, business) plus a payment-cards section. Light and dark mode follow the
  dashboard theme toggle; FR/EN with one click.
- **Sensitive-field protection** — `sin` (NAS), `ramq` and `driver_license` are flagged
  sensitive: while `sensitive_require_confirmation` is on (the default), the agent must
  ask the user for explicit confirmation before using them.
- **Payment cards, metadata only** — debit/credit cards with brand, last 4 digits,
  expiry, a free label and an `active|inactive` status (obsolete card, or deactivated
  by the provider). A full card number or a CVV is refused by the API, by design.
- **Field-level CLI** — the agent reads exactly the field a form needs, never the whole
  profile, and `list` never prints values.

## Install

```sh
ob-plugin install my-profile
```

Then open the **My Profile** tab in the open-bot dashboard and fill the form once.
Values go straight into the desktop key vault.

## CLI

`ob-plugin-my-profile-profile` — output is always a single JSON line, exit code
`0` ok · `2` usage/validation · `4` field not filled.

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

# payment cards — metadata only (brand, last4, expiry, status), never a full number
ob-plugin-my-profile-profile cards list [--status active|inactive]
ob-plugin-my-profile-profile cards active
ob-plugin-my-profile-profile cards add --type credit --brand visa --last4 1234 --label "perso" --expiry 2029-05
ob-plugin-my-profile-profile cards status 1234 inactive
ob-plugin-my-profile-profile cards update 1234 --label "nouveau nom" --expiry 2030-01
ob-plugin-my-profile-profile cards remove 1234

# is the confirmation policy on?  (settings.sensitive_require_confirmation)
ob-plugin-my-profile-profile policy
```

Fields:

- identity: `full_name`, `date_of_birth` (YYYY-MM-DD)
- contact: `address_line1`, `address_line2`, `city`, `province`, `postal_code`, `country`,
  `phone`, `email`, `work_email`
- government (sensitive): `sin`, `ramq`, `driver_license`
- business: `business_name`, `neq`, `gst_number`, `qst_number`

## Storage & privacy model

- Durable copy: the **key vault** (slugs `profile_identity`, `profile_contact`,
  `profile_government`, `profile_business`, `profile_cards`) — written through
  `ob-plugin vault`, never embedded in the manifest or the source.
- Read mirror: `~/.open-bot/pages-data/my-profile/profile.json`, `chmod 600`, kept in
  lockstep on every write so the CLI and the dashboard can read without vault round-trips.
- No public endpoint: the page server listens on loopback only and every API route stays
  behind the dashboard proxy. The page server never logs or prints values.
- Uninstall removes the mirror; vault slugs are removed with
  `ob-plugin vault my-profile --delete <slug>` (or the Plugins page) if the user wants
  every trace gone.

See [CONFIG.md](CONFIG.md) for the vault slugs, settings and the recommended
ask → fill → verify workflow for the installing agent.

## Development

```sh
ob-plugin validate .          # schema + local UI-bundle build
ob-plugin install --path .    # install from the checkout
bun scripts/contrast-check.ts # WCAG 4.5:1 audit, both themes
UI_PORT=<port> bun scripts/uitest.ts  # happy-dom end-to-end harness (fake values only)
```

The harness snapshots the read mirror and the vault slugs before touching anything,
runs every check with fake values, then restores both — real personal data is never
printed, never used.

## Author

shpaw415 · [shpaw415/my-profile](https://github.com/shpaw415/my-profile)
