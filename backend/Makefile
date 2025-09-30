BINARY ?= bin/mcp-backend
GOOS ?= linux
GOARCH ?= amd64
CGO_ENABLED ?= 0

.PHONY: build test run dev clean

build:
	GOOS=$(GOOS) GOARCH=$(GOARCH) CGO_ENABLED=$(CGO_ENABLED) go build -o $(BINARY) ./cmd/server

test:
	go test ./...

run:
	go run ./cmd/server

dev:
	air -c .air.toml

clean:
	rm -f $(BINARY)
