CREATE TABLE drive.activity_log (
    id           BIGSERIAL PRIMARY KEY,
    file_id      UUID REFERENCES drive.files(id)   ON DELETE CASCADE,
    folder_id    UUID REFERENCES drive.folders(id) ON DELETE CASCADE,
    user_id      UUID NOT NULL,
    user_display VARCHAR(255) NOT NULL DEFAULT '',
    action       VARCHAR(50)  NOT NULL,
    details      JSONB        NOT NULL DEFAULT '{}',
    created_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    CONSTRAINT activity_target CHECK (
        (file_id IS NOT NULL AND folder_id IS NULL) OR
        (file_id IS NULL     AND folder_id IS NOT NULL)
    )
);

CREATE INDEX idx_files_al_file    ON drive.activity_log(file_id,   created_at DESC) WHERE file_id   IS NOT NULL;
CREATE INDEX idx_files_al_folder  ON drive.activity_log(folder_id, created_at DESC) WHERE folder_id IS NOT NULL;
