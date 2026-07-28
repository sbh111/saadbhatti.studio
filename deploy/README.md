# Streaming stack deployment (Phase K2)

Runs the Kafka broker + HTTP collector + Caddy (TLS) on a single EC2 box. The
Next app (Vercel) POSTs events to `https://<INGEST_DOMAIN>/events`; the collector
authenticates them and produces to Kafka on the private network. Kafka is never
exposed to the internet. Full context: [`../docs/kafkaEventsPlan.md`](../docs/kafkaEventsPlan.md).

## Before you start

- **Set a billing alarm** (AWS Budgets + a CloudWatch billing alarm) *first*.
- Apply the K1 migration to Neon so `settings`/`likes` exist in prod:
  `npx prisma migrate deploy` (with the Neon URLs as real env vars).
- Verify current free-tier terms, especially **public IPv4** charges.

## Instance

- Amazon Linux 2023, **t3.micro** (or t2.micro), gp3 root volume.
- Security group inbound: `22` from **your IP /32 only**, `80` + `443` from
  anywhere. **Do NOT open `9092` or `8000`.**

## Provision (SSH in as ec2-user)

```bash
sudo dnf install -y docker docker-compose-plugin
sudo systemctl enable --now docker
sudo usermod -aG docker ec2-user   # log out/in for this to take effect
```

Add swap — 1 GB RAM is tight for a JVM broker + collector:

```bash
sudo dd if=/dev/zero of=/swapfile bs=1M count=2048
sudo chmod 600 /swapfile && sudo mkswap /swapfile && sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
```

## Deploy

```bash
git clone <this repo> sbh && cd sbh/deploy
cp .env.example .env          # fill in EVENT_INGEST_TOKEN (openssl rand -base64 32) + INGEST_DOMAIN
docker compose -f compose.prod.yml up -d --build
```

Point Porkbun DNS: `A  <INGEST_DOMAIN>  ->  <instance public/Elastic IP>`.
Caddy fetches the TLS cert automatically on the first HTTPS hit.

## Verify

```bash
curl https://<INGEST_DOMAIN>/health                 # {"ok":true} over valid TLS
# events land in the broker (9092 only reachable inside the container):
docker compose -f compose.prod.yml exec kafka \
  kafka-console-consumer --bootstrap-server localhost:9092 \
  --topic web.events.v1 --from-beginning --property print.key=true
```

From your laptop, confirm 9092 is closed (must FAIL): `nc -vz <INGEST_DOMAIN> 9092`

## Wire up Vercel

Set `EVENT_COLLECTOR_URL=https://<INGEST_DOMAIN>/events` and `EVENT_INGEST_TOKEN`
(same token as `deploy/.env`) in Vercel env vars, **redeploy**, then flip
Event streaming **on** at `/admin/settings`.

## Cost control / teardown

- Not learning right now? `docker compose -f compose.prod.yml down` and **stop** the instance.
- Done for good? **Terminate** the instance, **release** the Elastic IP, delete the
  EBS volume/snapshots, and flip the toggle back **off** in `/admin/settings`.
