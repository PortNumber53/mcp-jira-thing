BINARY ?= bin/mcp-backend

.PHONY: build test run dev clean

build:
	go build -o $(BINARY) ./cmd/server

test:
	go test ./...

run:
	go run ./cmd/server

dev:
	air -c .air.toml

clean:
	rm -f $(BINARY)
