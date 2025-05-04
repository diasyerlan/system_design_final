#!/bin/bash
set -e

# Stop PostgreSQL service
pg_ctl -D "$PGDATA" -m fast -w stop

# Clear the data directory
rm -rf ${PGDATA}/*

# Initialize replica from primary
pg_basebackup -h postgres-primary -p 5432 -U replicator -X stream -C -S replica_slot_1 -v -R -w -D ${PGDATA}

# Configure replica settings
cat > ${PGDATA}/postgresql.conf << EOF
listen_addresses = '*'
hot_standby = on
primary_conninfo = 'host=postgres-primary port=5432 user=replicator password=replpass application_name=replica1'
primary_slot_name = 'replica_slot_1'
EOF

# Create recovery.signal file
touch ${PGDATA}/recovery.signal

# Allow replication connections
cat >> ${PGDATA}/pg_hba.conf << EOF
host replication replicator all md5
host all all all md5
EOF

# Make script executable
chmod +x /docker-entrypoint-initdb.d/init-replica.sh 