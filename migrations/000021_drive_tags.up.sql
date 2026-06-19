-- Colored tags (labels) owned by a user, assignable to files and folders.
-- A cross-cutting organization layer on top of the folder hierarchy.
CREATE TABLE drive.tags (
    id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    owner_id    UUID NOT NULL,                           -- core.users.id (logical reference)
    name        VARCHAR(64) NOT NULL,
    color       VARCHAR(20) NOT NULL DEFAULT 'gray',     -- named palette color or hex
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT tags_owner_name_unique UNIQUE (owner_id, name)
);

CREATE INDEX idx_drive_tags_owner ON drive.tags(owner_id);

-- Tag ↔ file association
CREATE TABLE drive.file_tags (
    tag_id     UUID NOT NULL REFERENCES drive.tags(id)  ON DELETE CASCADE,
    file_id    UUID NOT NULL REFERENCES drive.files(id) ON DELETE CASCADE,
    owner_id   UUID NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (tag_id, file_id)
);

CREATE INDEX idx_drive_file_tags_file  ON drive.file_tags(file_id);
CREATE INDEX idx_drive_file_tags_owner ON drive.file_tags(owner_id);

-- Tag ↔ folder association
CREATE TABLE drive.folder_tags (
    tag_id     UUID NOT NULL REFERENCES drive.tags(id)    ON DELETE CASCADE,
    folder_id  UUID NOT NULL REFERENCES drive.folders(id) ON DELETE CASCADE,
    owner_id   UUID NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (tag_id, folder_id)
);

CREATE INDEX idx_drive_folder_tags_folder ON drive.folder_tags(folder_id);
CREATE INDEX idx_drive_folder_tags_owner  ON drive.folder_tags(owner_id);

CREATE TRIGGER tags_updated_at
    BEFORE UPDATE ON drive.tags
    FOR EACH ROW EXECUTE FUNCTION drive.set_updated_at();
