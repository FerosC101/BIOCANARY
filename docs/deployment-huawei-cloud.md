# Huawei Cloud deployment

The adapters are implemented and tested against local stand-ins (real PostgreSQL, a Redis protocol emulator, a fake OBS client, the actual inference container over HTTP, a mocked IAM flow). **They have not been run against a Huawei Cloud account, and the Docker images have not been built.** Work through the checks below on first deployment.

## 1. Resources

Create in one region and VPC:

| Service | Suggested start | Notes |
|---|---|---|
| ECS | 2 vCPU, 4 GB, Ubuntu 22.04 | Security group: 443 from users and devices, 22 from administrators |
| RDS for PostgreSQL | 2 vCPU, 4 GB, version 14 or later | Private address; allow 5432 from the ECS group; enable SSL and backups |
| DCS for Redis | 1 GB, version 6.0 or later | Private address; allow 6379 from the ECS group |
| OBS | Private bucket | IAM user limited to this bucket |
| ModelArts | Real-time service, 1 CPU instance | See step 4 |

## 2. Configure and start

On the ECS instance, with Docker installed:

```sh
git clone <repository> biocanary && cd biocanary
cp deploy/.env.example deploy/.env    # fill in, chmod 600
docker compose -f deploy/docker-compose.yml up -d --build
docker compose -f deploy/docker-compose.yml exec api python -m app.cli create-user you@example.com "Your Name" --role admin
docker compose -f deploy/docker-compose.yml exec api python -m app.cli check-services
```

Migrations run at start-up. The API refuses to start in production with the development secret or the default demo password. Put an ELB with a certificate, or another TLS terminator, in front of port 80.

## 3. Verify

`check-services` must list all five services as `connected`, and the top bar must read **Huawei Cloud connected**. If one fails, its row shows the actual error. Then confirm an end-to-end path: post a reading, open the dashboard, export a PDF, and find the object in OBS.

## 4. ModelArts

**Training.** Upload the dataset with `python -m app.cli upload-dataset ml/data/simulated.csv`. Create a training job with a MindSpore image, boot file `ml/train.py`, input parameter `data_url` and output parameter `train_url`. The trainer accepts both names and ignores arguments ModelArts adds.

**Evaluation.** The job writes `inhibition_classifier.json` containing metrics, calibration and the dataset hash. Review it before deployment.

**Inference.** Build `ml/modelarts/Dockerfile`, push it to SWR, import it as a custom-image model with HTTP on port 8080, `/health` as the health check and `POST /infer`, then deploy a real-time service. Set the endpoint and AppCode (or IAM credentials).

To start without ModelArts set `BIOCANARY_INFERENCE_PROVIDER=local`. The top bar then reads 4 of 5 services.

## 5. What is stored where

| OBS prefix | Contents |
|---|---|
| `raw/{origin}/{station}/{yyyy}/{mm}/` | Daily raw measurements, gzip CSV |
| `reports/{origin}/{station}/{yyyy}/{mm}/` | Generated PDF and CSV |
| `datasets/` | Training datasets |

## Operations

- Logs: `docker compose logs api`. Health: `GET /api/v1/health`.
- Backfill archives: `python -m app.cli archive --days 30`.
- Scale out: several API instances can share RDS and DCS. Keep `BIOCANARY_RUN_BACKGROUND_WORKER=true`; locks prevent duplicate work.
