# Public database trust anchor

`supabase-root-2021.crt` is a public CA certificate, not a client certificate or key.
Downloaded 2026-10-25 over HTTPS from Supabase's public distribution:
https://supabase-downloads.s3-ap-southeast-1.amazonaws.com/prod/ssl/prod-ca-2021.crt

Supabase documents the downloaded CA with `sslmode=verify-full`, including Session
pooler usage: https://supabase.com/docs/guides/database/psql
and https://supabase.com/docs/guides/platform/ssl-enforcement .

Subject/issuer: Supabase Root 2021 CA / Supabase Inc. Self-signed RSA CA.
Validity: 2021-04-28 through 2031-04-26.
PEM SHA-256 (LF): `700723581420dd1ac98fd7e9ac529f0ef210eadcaf87fc868a3ad7d114c2f3b7`.
DER SHA-256: `807025ad50d4ed219d2c9c7d299c004f824eb00cf7f65afef607d07b72e6cafa`.

The runtime verifies both hashes, validity, CA flag and self-signature before
creating a connection. It supplies the absolute path explicitly to libpq; no
implicit OS/OpenSSL trust-store dependency and no weaker SSL fallback. Rotation
requires an independently reviewed public certificate and updated pins/tests.
No project connection or credential was used to obtain this file.
