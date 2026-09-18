-- Vibe Motion baseline schema.
--
-- A project holds one immutable cloned page (base_html, every element carrying data-vm-id).
-- A version stores the diff from its parent, never full state; state is folded from v0 in the API.
-- Nothing here stores generated CSS: it is derived from (animationId, catalogVersion) + params.

create table projects (
    id                 uuid        primary key,
    source_url         text        not null,
    title              text        not null default '',
    base_html          text        not null,
    current_version_id uuid        null,
    created_at         timestamptz not null default now()
);

create table versions (
    id                uuid        primary key,
    project_id        uuid        not null references projects (id) on delete cascade,
    parent_version_id uuid        null references versions (id),
    seq               integer     not null,
    label             text        not null default '',
    catalog_version   text        not null,
    diff              jsonb       not null,
    created_at        timestamptz not null default now(),
    -- Postgres backs this constraint with a btree over (project_id, seq), which is also the
    -- index every "versions of a project, in order" read wants. No separate index is needed.
    constraint versions_project_id_seq_key unique (project_id, seq)
);

-- projects and versions point at each other, so this side is added afterwards and deferred:
-- creating a project with its version 0, or deleting a project, happens in one transaction.
alter table projects
    add constraint projects_current_version_id_fkey
    foreign key (current_version_id) references versions (id)
    deferrable initially deferred;
