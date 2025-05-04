# Reels Microservice Architecture

A scalable microservice architecture for handling reels functionality with load balancing, database replication, connection pooling, WebSocket sharding, and CDN for media delivery.

## Architecture Overview

![Architecture Diagram](https://mermaid.ink/img/pako:eNqNk81OwzAQhF_F2nNIIlJzKkWVEHABceEKh01iNRvW3jqOEFR9d5wfkBalpT51dz7PTLLeTbFOlOZYwJPjh-6Qfh7a8_XH8-D4ql2F1jxZxNaQQx09GnJ-6Mgrb8hhtF9JfKCgNq7S4a6-73r63VgNpNW5fncU-mpKKb2O_fMuUUhGk_FPXyLN2ixFVlUmH7kgJI_Ol9Qs65Xfey8mjDsKBuG_qmYy1d8GJvuaXLn2kP5vZIjz2mL4jdwSZXqXfBQFfUk-iVgdAVKC6V_DfjKBnwZWKIvgGZVkYHJFSV4VfkKr4V5VmDdYnR1HRV5bI1m2BZZFcI61n9EbvWY4eHScZDJuIcWlTSqcJTgbZwWuekw2Iy27Ry6SOJtZgrNkgfvQvSC26WNeLnGxwH3EjHAj-9QLI3J7pRcSe-H0GxZmytc=)

### Components:

1. **Nginx Load Balancer**
   - Distributes traffic across multiple reels service instances
   - Routes WebSocket connections to appropriate shards
   - Routes CDN requests to the CDN service with caching

2. **CDN Service**
   - Handles media content delivery with high performance
   - Provides on-the-fly image resizing
   - Uses Redis for caching
   - Organizes files by date for better management
   - Generates thumbnails automatically

3. **Reels Microservice**
   - Multiple instances for horizontal scaling
   - Handles CRUD operations for reels
   - Communicates with database through PgBouncer

4. **WebSocket Service with Sharding**
   - Multiple shards to handle real-time notifications
   - Uses Redis for pub/sub communication
   - Consistent hashing for connection distribution

5. **PostgreSQL with Replication**
   - Primary-replica setup for high availability
   - Automatic failover support

6. **PgBouncer**
   - Connection pooling for efficient database access
   - Manages connections to both primary and replica

7. **Redis**
   - Used for caching and pub/sub messaging
   - Inter-service communication

## Getting Started



### Detailed Installation and Launch Instructions

#### 1. Clone the Repository

```bash
git clone https://github.com/yourusername/reels-microservice.git
cd reels-microservice
```

#### 2. Configure Environment (Optional)

The system uses sensible defaults, but you can customize it by creating a `.env` file in the root directory:

```bash
# Example .env file
POSTGRES_PASSWORD=your_secure_password
REDIS_PASSWORD=your_secure_redis_password
CDN_CACHE_TTL=86400
```

#### 3. Directory Structure Setup

Ensure proper permission for data directories:

```bash
# Create required directories
mkdir -p ./cdn-service/public
mkdir -p ./postgres/primary
mkdir -p ./postgres/replica
mkdir -p ./nginx/conf.d

# Set proper permissions
chmod -R 755 ./cdn-service/public
```

#### 4. Start the Services

For development environment:

```bash
# Start all services in development mode
docker-compose up
```

For production environment:

```bash
# Start all services in detached mode
docker-compose up -d

# Check if all services are running properly
docker-compose ps
```

#### 5. Scaling Services (Optional)

You can scale specific services to handle more load:

```bash
# Scale reels services to 4 instances
docker-compose up -d --scale reels-service-1=2 --scale reels-service-2=2

# Scale WebSocket shards to 3 instances
docker-compose up -d --scale ws-shard-1=2 --scale ws-shard-2=1
```

#### 6. Verify the Setup

Check if all services are running properly:

```bash
# List all running containers
docker-compose ps

# Check logs of a specific service
docker-compose logs -f nginx
docker-compose logs -f reels-service-1
docker-compose logs -f cdn-service
```

Access the API endpoints:

- Reels Service: http://localhost/api/reels
- Health Check: http://localhost/health
- CDN Upload: http://localhost/cdn/upload

#### 7. Testing the CDN Upload

You can test file uploads to the CDN using curl:

```bash
# Upload an image to the CDN
curl -X POST -F "file=@/path/to/your/image.jpg" http://localhost/cdn/upload

# The response will contain URLs to access the uploaded file
# Example response:
# {
#   "fileUrl": "/cdn/2023/06/15/a1b2c3d4-1234-5678-90ab-cdef12345678.jpg",
#   "thumbnailUrl": "/cdn/2023/06/15/thumb_a1b2c3d4-1234-5678-90ab-cdef12345678.jpg",
#   "filename": "a1b2c3d4-1234-5678-90ab-cdef12345678.jpg",
#   "size": 1024000,
#   "mimetype": "image/jpeg"
# }
```

#### 8. Testing the Reels API

Create a new reel using the CDN URL:

```bash
# Create a new reel
curl -X POST -H "Content-Type: application/json" -d '{
  "user_id": "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11",
  "video_url": "/cdn/2023/06/15/a1b2c3d4-1234-5678-90ab-cdef12345678.mp4",
  "caption": "My awesome reel!"
}' http://localhost/api/reels
```

Get all reels:

```bash
# List all reels
curl -X GET http://localhost/api/reels
```

#### 9. Testing WebSocket Connections

You can test WebSocket connections using a tool like wscat:

```bash
# Install wscat
npm install -g wscat

# Connect to WebSocket server
wscat -c "ws://localhost/ws?userId=a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11"

# Send a ping message
{"type":"PING"}
```

#### 10. Monitoring and Administration

Monitor the system using Docker Compose commands:

```bash
# Monitor CPU and memory usage
docker stats

# Check service logs
docker-compose logs -f

# Restart a specific service
docker-compose restart reels-service-1
```

#### 11. Stopping the Services

When you're done, stop the services:

```bash
# Stop all services but keep the data volumes
docker-compose stop

# Stop and remove all containers, networks, and volumes
docker-compose down -v
```

## API Endpoints

### Reels Service

- `GET /api/reels` - List reels
- `GET /api/reels/:id` - Get a specific reel
- `POST /api/reels` - Create a new reel
- `POST /api/reels/:id/like` - Like a reel

### CDN Service

- `POST /upload` - Upload a media file
- `GET /public/*` - Retrieve a media file
- `GET /resize/:width/:height/*` - Get a resized version of an image
- `DELETE /cache/:path` - Purge cached items matching a path

### WebSocket Events

- `NEW_REEL` - Notification when a new reel is created
- `REEL_LIKED` - Notification when a reel is liked

## Architecture Details

### Load Balancing

Nginx is configured to distribute traffic to multiple reels service instances using the ip_hash algorithm, ensuring that requests from the same client are routed to the same backend service.

### Content Delivery Network (CDN)

The CDN service provides optimized delivery of media content:
- Efficient file storage and organization by date
- Automatic thumbnail generation
- On-the-fly image resizing
- Advanced caching with Redis
- Cache purging capabilities
- High-performance static file delivery

### Database Replication

PostgreSQL is set up with a primary-replica architecture where:
- Primary node handles write operations
- Replica node handles read operations 
- Automatic streaming replication

### Connection Pooling with PgBouncer

PgBouncer manages database connections to:
- Reduce connection overhead
- Improve performance under high load
- Route read queries to replicas and write queries to primary

### WebSocket Sharding

WebSocket connections are distributed across multiple shards using consistent hashing, ensuring:
- Even distribution of client connections
- Reduced memory pressure per instance
- Efficient broadcasting of events

## Troubleshooting

### Common Issues and Solutions

1. **PostgreSQL replication not working**
   - Check if primary server is properly configured: `docker-compose exec postgres-primary cat ${PGDATA}/postgresql.conf`
   - Verify replication slots: `docker-compose exec postgres-primary psql -U postgres -c "SELECT * FROM pg_replication_slots;"`

2. **Redis connection errors**
   - Check Redis logs: `docker-compose logs redis`
   - Verify network connectivity: `docker-compose exec reels-service-1 ping redis`

3. **WebSocket connections failing**
   - Check Nginx configuration: `docker-compose exec nginx nginx -t`
   - Verify WebSocket routing: `docker-compose logs ws-shard-1`

4. **CDN uploads failing**
   - Check filesystem permissions: `docker-compose exec cdn-service ls -la /app/public`
   - Verify Redis connectivity for CDN service: `docker-compose logs cdn-service`

5. **PgBouncer connection issues**
   - Check PgBouncer configuration: `docker-compose exec pgbouncer cat /etc/pgbouncer/pgbouncer.ini`
   - Verify database connection: `docker-compose exec pgbouncer pgbouncer-admin show pools`

## Monitoring and Health Checks

Each service exposes a `/health` endpoint that returns:
- Service status
- Instance ID
- Additional service-specific metrics

## License

MIT 