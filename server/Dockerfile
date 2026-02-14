# Use a Node.js base image
FROM node:20-alpine

# Set the working directory
WORKDIR /app

# Install dependencies
RUN npm install

# Copy the rest of the application code
COPY . .

# Build the application
RUN npm run build

# Expose the port the app runs on
ENV PORT 8080
EXPOSE 8080

# Start the application
CMD [ "npm", "start" ]
