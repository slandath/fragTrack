FROM golang:1.26-alpine AS build
WORKDIR /src
COPY app/go.mod app/go.sum ./
RUN go mod download
COPY app/ .
RUN CGO_ENABLED=0 go build -trimpath -o /out/fragtrack .

FROM alpine:3.20
WORKDIR /app
COPY --from=build /out/fragtrack /app/fragtrack
EXPOSE 3000
CMD ["/fragtrack"]
