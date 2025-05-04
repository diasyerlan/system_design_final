FROM node:18-alpine

# Install dependencies for Sharp
RUN apk add --no-cache python3 make g++ vips-dev

# Set working directory
WORKDIR /app

# Copy package.json and package-lock.json
COPY package*.json ./

# Install dependencies
RUN npm install

# Copy application code
COPY . .

# Create storage directory
RUN mkdir -p /app/public

# Expose the port
EXPOSE 5000

# Start the application
CMD ["npm", "start"] 