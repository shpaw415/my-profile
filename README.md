# my-profile

Personal profile vault for open-bot: the user fills their identity, contact,
government ID and business numbers **once** (dashboard form → key vault), and
the agent serves themselves field by field when a tax form, government form
or any document needs personal details.

- Storage: key vault only (`profile_identity`, `profile_contact`,
  `profile_government`, `profile_business` — JSON blobs), never plaintext
  files, never the manifest.
- CLI: `ob-plugin-my-profile-profile` — `list`, `get <field>`, `set`,
  `cards list|active|add|status|update|remove`, `policy`, `slugs`.
  Single-line JSON output, field-level access only.
- Cards: debit/credit with an active|inactive status (obsolete or
  deactivated by the provider). Metadata only — brand, last 4 digits, expiry;
  a full card number or CVV is refused by design.
- Dashboard: **My Profile** tab — one form, light + dark mode, FR/EN.
- Safety: `sin`, `ramq`, `driver_license` are sensitive — the agent always
  asks the user before using them while the `sensitive_require_confirmation`
  setting is on (default).
