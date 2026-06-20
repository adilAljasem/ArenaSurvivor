# ==========================================
# STAGE 1: Build the Vite Frontend (Node.js)
# ==========================================
FROM node:20-alpine AS client-build
WORKDIR /app

# Copy the client dependency files first to cache the npm install step
COPY Client/package*.json ./Client/
WORKDIR /app/Client
RUN npm ci

# Copy the rest of the client code
COPY Client/ ./

# Create the target directory for Vite to output into (../Server/wwwroot)
RUN mkdir -p /app/Server/wwwroot

# Build the Phaser/Vite client
RUN npm run build


# ==========================================
# STAGE 2: Build the Backend (.NET SDK)
# ==========================================
FROM mcr.microsoft.com/dotnet/sdk:10.0 AS server-build
WORKDIR /app

# Copy the C# project file and restore dependencies
COPY Server/*.csproj ./Server/
WORKDIR /app/Server
RUN dotnet restore

# Copy the rest of the server code
WORKDIR /app
COPY Server/ ./Server/

# Pull the compiled wwwroot files from Stage 1 into the Server folder
COPY --from=client-build /app/Server/wwwroot ./Server/wwwroot

# Publish the .NET application
WORKDIR /app/Server
RUN dotnet publish -c Release -o /app/publish


# ==========================================
# STAGE 3: Final Runtime Image
# ==========================================
FROM mcr.microsoft.com/dotnet/aspnet:10.0 AS runtime
WORKDIR /app

# Expose the standard .NET 8 Docker port
EXPOSE 8080
ENV ASPNETCORE_HTTP_PORTS=8080

# Copy the final compiled server (which now includes wwwroot) from Stage 2
COPY --from=server-build /app/publish .

# Start the application
ENTRYPOINT ["dotnet", "Server.dll"]