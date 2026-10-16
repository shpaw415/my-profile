# my-profile — configuration guide (for the installing agent)

This plugin stores the user's personal profile in the desktop key vault so
the agent can fill tax, government and other forms without asking for the
same details every time. There are **no API keys** — every value is the
user's own personal information, and the user must type it (or approve it)
themselves.

## What it needs

Four vault slugs, each a JSON blob of that group's fields:

| Slug | Fields | Sensitive |
|---|---|---|
| `profile_identity` | full_name, date_of_birth | no |
| `profile_contact` | address_line1, address_line2, city, province, postal_code, country, phone, email, work_email | no |
| `profile_government` | sin, ramq, driver_license | **yes** |
| `profile_business` | business_name, neq, gst_number, qst_number | no |
| `profile_cards` | JSON array of payment cards (type, brand, last4, expiry, label, status active\|inactive) | no — metadata only, never a full number |

Settings:

- `sensitive_require_confirmation` (bool, default **true**): while on, the
  agent must ask the user for explicit confirmation before it writes a
  sensitive value (sin / ramq / driver_license) into any form or document.
  Only turn it off if the user explicitly asks for free access — the default
  is "always ask".

## Ask → fill → verify

1. **Ask** the user for the values group by group. Sensitive values (NAS,
   RAMQ, driver's license) should be typed by the user, not pasted through
   chat when avoidable.
2. **Fill** — preferred: the **My Profile** tab in the dashboard (one form,
   all groups). Alternative from the shell:
   `ob-plugin-my-profile-profile set city "Québec"` (one field at a
   time), or `ob-plugin vault my-profile profile_identity='{"full_name":"..."}'`
   for a whole slug.
3. **Verify**:
   ```sh
   ob-plugin-my-profile-profile list      # which fields are filled
   ob-plugin-my-profile-profile get city  # prints exactly one value
   ```

## Storage note (read mirror)

Every write goes to two places at once: the key vault (durable, write-only
copy) and a local read mirror (`~/.open-bot/pages-data/my-profile/profile.json`,
chmod 600) that the CLI and the dashboard read from. Reason: the desktop
currently only syncs vault values into the plugin config file during its
periodic sweep, not right after a write (defect filed with open-bot). Fill
values through the dashboard tab or the CLI so both layers stay in sync;
a vault-only edit from the Plugins page appears locally after the next sweep.

## Prove it works

- `ob-plugin-my-profile-profile get city` returns the city the user entered.
- `ob-plugin-my-profile-profile policy` returns
  `sensitive_require_confirmation: true` (default).
- The dashboard **My Profile** tab shows the saved values back, in light and
  dark mode, in French or English.

Never write real personal values into this guide, into the manifest, or
anywhere outside the vault.
