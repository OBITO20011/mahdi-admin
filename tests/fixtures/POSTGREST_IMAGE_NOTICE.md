# PostgREST test image fixture

This is the unchanged official Supabase PostgREST v16.1 Linux/amd64 image, saved with Docker and gzip for isolated QA. It contains no application data, containers, database state or credentials. The fixture is about6.5MB and removes anonymous registry quota failures from actual SDK/ACL probes.

- Official index digest:`sha256:5922bde07147b82b1c9d8f749e48c1e5b99ebb233f3888bb7ab65f07cf4ac82d`.
- Official amd64 manifest:`sha256:73e76c305027cb1119bc7c6ab82449d9e1a50a9e8697f4ebac5443dc63590c90`.
- Config:`sha256:eb4951a2f9ac02288100937995af3cb7fb64c296b1228405de5d77ca4dd3410d`.
- Archive SHA256:`f68c7e96cf47296e13b2db0a4b52fd040df216bc082c8218621bf5b8a33d1d91`.

The independent existing registry manifest fixture anchors the entire blob/config/filesystem chain. The loader verifies archive bytes,loaded image identity,platform,filesystem,unprivileged image user and startup command,then checks the exact version with networking disabled. It returns a local immutable image ID. The ordinary PostgREST server launch retains its environment,port,readiness and actual-query contracts. There is no network pull,registry login,new retry or test skip.

Source images are the same digest at `public.ecr.aws/supabase/postgrest:v16.1` and `ghcr.io/supabase/postgrest:v16.1`. Upstream source and license: https://github.com/PostgREST/postgrest/tree/v16.1 and `postgrest-v16.1.LICENSE` in this directory. All original image layers and config are retained unchanged;only the local QA tag is added during Docker export. Never create this fixture from a running application container.
