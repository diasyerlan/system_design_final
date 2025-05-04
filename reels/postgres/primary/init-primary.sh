#!/bin/bash
set -e

# Create replication role
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<-EOSQL
    CREATE ROLE replicator WITH REPLICATION PASSWORD 'replpass' LOGIN;
EOSQL

# Configure primary server for replication
cat > ${PGDATA}/postgresql.conf << EOF
listen_addresses = '*'
wal_level = replica
max_wal_senders = 10
max_replication_slots = 10
wal_keep_size = 1GB
hot_standby = on
EOF

# Allow replication connections
cat >> ${PGDATA}/pg_hba.conf << EOF
host replication replicator all md5
host all all all md5
EOF

# Create reels table and sample data
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<-EOSQL
    CREATE TABLE IF NOT EXISTS reels (
        id SERIAL PRIMARY KEY,
        user_id UUID NOT NULL,
        video_url TEXT NOT NULL,
        caption TEXT,
        likes INT DEFAULT 0,
        views INT DEFAULT 0,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS reels_user_id_idx ON reels(user_id);
    CREATE INDEX IF NOT EXISTS reels_created_at_idx ON reels(created_at);

    INSERT INTO reels (user_id, video_url, caption) VALUES 
    ('a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11', '/cdn/2023/05/15/a1b2c3d4-1234-5678-90ab-cdef12345678.mp4', 'My first reel! #awesome'),
    ('a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11', '/cdn/2023/05/16/e5f6g7h8-2345-6789-01bc-def123456789.mp4', 'Beach day vibes #summer'),
    ('b5f86350-2181-47c0-8f57-98b59cf1df7c', '/cdn/2023/05/17/i9j0k1l2-3456-7890-12cd-ef1234567890.mp4', 'Cooking tutorial #foodie');
EOSQL

# Make script executable
chmod +x /docker-entrypoint-initdb.d/init-primary.sh 