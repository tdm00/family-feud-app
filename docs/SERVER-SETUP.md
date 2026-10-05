# Server setup and deployment

This runbook starts with a newly created Ubuntu 24.04 DigitalOcean Droplet and ends with automatic deployments from GitHub. The production server runs one Family Feud app container and one Caddy container. Caddy obtains and renews the TLS certificate.

Do not run more than one app container. The app uses one SQLite database and resolves simultaneous buzzes in that database.

## Values used in this guide

Replace these examples everywhere they appear:

| Example | Replace with |
| --- | --- |
| `203.0.113.10` | Droplet public IPv4 address |
| `feud.example.com` | Production hostname |
| `deploy` | Non-root deployment user, if using another name |
| `tdm00/family-feud-app` | GitHub owner and repository |

You need:

- Root SSH access to the new Droplet using an SSH key.
- Control of the domain's DNS.
- Admin access to the GitHub repository.
- A local workstation with `ssh` and `ssh-keygen`.

Two separate SSH keys are used:

1. **GitHub Actions key:** GitHub Actions uses its private key to log in to the Droplet. Its public key is in the Droplet user's `authorized_keys`.
2. **Repository deploy key:** The Droplet uses its private key to pull the private repository. Its public key is a read-only deploy key in GitHub.

Do not reuse either key for personal SSH access.

## 1. Point DNS at the Droplet

At the DNS provider, create:

- Type: `A`
- Name: the desired hostname, such as `feud`
- Value: the Droplet IPv4 address
- TTL: `300` while setting up

Only add an `AAAA` record if IPv6 is configured and reachable on the Droplet. An incorrect `AAAA` record can prevent Caddy from obtaining a certificate.

DNS can take time to propagate. Check it from the workstation:

```bash
dig +short feud.example.com A
```

Continue when it returns the Droplet IP. Ports 80 and 443 must be reachable before the first Caddy start.

## 2. Create the deployment user

Connect as root:

```bash
ssh root@203.0.113.10
```

Update the server and install basic administration tools:

```bash
apt update
apt full-upgrade -y
apt install -y ca-certificates curl git openssl ufw unattended-upgrades fail2ban
```

Create a non-root user. Give it a strong password and save that password in a password manager; SSH password login will be disabled, but the password is still used for `sudo`. Then copy the root user's initial SSH authorization:

```bash
adduser deploy
usermod -aG sudo deploy
install -d -m 700 -o deploy -g deploy /home/deploy/.ssh
cp /root/.ssh/authorized_keys /home/deploy/.ssh/authorized_keys
chown deploy:deploy /home/deploy/.ssh/authorized_keys
chmod 600 /home/deploy/.ssh/authorized_keys
```

In a second workstation terminal, verify the new account before changing SSH settings:

```bash
ssh deploy@203.0.113.10
sudo whoami
```

`sudo whoami` must print `root`. Keep the original root session open until SSH hardening is verified.

## 3. Configure the firewall and SSH

On the Droplet, allow SSH before enabling the firewall:

```bash
sudo ufw allow OpenSSH
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw enable
sudo ufw status verbose
```

Create an SSH hardening drop-in:

```bash
sudo tee /etc/ssh/sshd_config.d/99-family-feud.conf >/dev/null <<'EOF'
PasswordAuthentication no
KbdInteractiveAuthentication no
PermitRootLogin no
PubkeyAuthentication yes
EOF
```

Validate and reload SSH:

```bash
sudo sshd -t
sudo systemctl reload ssh
```

Open another new connection and confirm `deploy` can still log in:

```bash
ssh deploy@203.0.113.10
```

Do not close the original root session until this succeeds.

Enable security updates and intrusion protection:

```bash
sudo dpkg-reconfigure -plow unattended-upgrades
sudo systemctl enable --now fail2ban
sudo systemctl status fail2ban --no-pager
```

## 4. Install Docker Engine and Compose

Run the following on the Droplet as `deploy`. These commands use Docker's official Ubuntu repository:

```bash
sudo install -m 0755 -d /etc/apt/keyrings
sudo curl -fsSL https://download.docker.com/linux/ubuntu/gpg \
  -o /etc/apt/keyrings/docker.asc
sudo chmod a+r /etc/apt/keyrings/docker.asc

echo \
  "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu \
  $(. /etc/os-release && echo "${UBUNTU_CODENAME:-$VERSION_CODENAME}") stable" \
  | sudo tee /etc/apt/sources.list.d/docker.list >/dev/null

sudo apt update
sudo apt install -y docker-ce docker-ce-cli containerd.io \
  docker-buildx-plugin docker-compose-plugin
sudo systemctl enable --now docker
sudo usermod -aG docker deploy
```

Limit Docker's local JSON logs so they cannot consume the disk:

```bash
sudo tee /etc/docker/daemon.json >/dev/null <<'EOF'
{
  "log-driver": "json-file",
  "log-opts": {
    "max-size": "10m",
    "max-file": "3"
  }
}
EOF
sudo systemctl restart docker
```

Log out and reconnect so the new `docker` group takes effect:

```bash
exit
ssh deploy@203.0.113.10
docker version
docker compose version
docker run --rm hello-world
```

Membership in the `docker` group effectively grants root-level access. Only trusted administrators should belong to it.

## 5. Give the Droplet read-only repository access

On the Droplet, generate a dedicated repository key:

```bash
ssh-keygen -t ed25519 \
  -C "family-feud production read-only" \
  -f ~/.ssh/id_ed25519_github \
  -N ""
cat ~/.ssh/id_ed25519_github.pub
```

Copy the displayed public key. In GitHub:

1. Open the `tdm00/family-feud-app` repository.
2. Open **Settings → Deploy keys → Add deploy key**.
3. Title it `Family Feud production Droplet`.
4. Paste the public key.
5. Leave **Allow write access** unchecked.
6. Add the key.

Configure SSH on the Droplet to use that key:

```bash
cat >~/.ssh/config <<'EOF'
Host github.com
  HostName github.com
  User git
  IdentityFile ~/.ssh/id_ed25519_github
  IdentitiesOnly yes
EOF
chmod 600 ~/.ssh/config
ssh -T git@github.com
```

On first connection, compare the shown host-key fingerprint with GitHub's published SSH fingerprints before accepting it. A successful test says authentication succeeded and that GitHub does not provide shell access.

## 6. Clone the application

Create the fixed deployment directory expected by GitHub Actions:

```bash
sudo install -d -m 755 -o deploy -g deploy /opt/family-feud
git clone --branch main --single-branch \
  git@github.com:tdm00/family-feud-app.git \
  /opt/family-feud
cd /opt/family-feud
git status
```

The branch must be `main`, and the working tree should be clean.

## 7. Create production secrets and persistent storage

Create the data directory before starting the containers:

```bash
cd /opt/family-feud
install -d -m 700 data
```

Generate a host password and session secret. Save the host password in a password manager:

```bash
HOST_PASSWORD="$(openssl rand -base64 24)"
SESSION_SECRET="$(openssl rand -hex 32)"
printf 'Host password: %s\n' "$HOST_PASSWORD"
```

Choose a room code containing 3–16 letters or numbers, then create `.env`:

```bash
umask 077
cat >.env <<EOF
HOST_PASSWORD=$HOST_PASSWORD
ROOM_CODE=FEUD
SESSION_SECRET=$SESSION_SECRET
DOMAIN=feud.example.com
EOF
chmod 600 .env
unset HOST_PASSWORD SESSION_SECRET
```

Confirm that the required keys exist without printing their values:

```bash
cut -d= -f1 .env
```

Expected keys are `HOST_PASSWORD`, `ROOM_CODE`, `SESSION_SECRET`, and `DOMAIN`.

Important behavior:

- `.env` stays only on the Droplet and is ignored by Git.
- `data/` stays only on the Droplet and is mounted into the app container.
- Compose sets `DATABASE_PATH=/app/data/feud.sqlite`, `PORT=3000`, and `NODE_ENV=production`; they do not need to be in `.env`.
- `ROOM_CODE` seeds the database only when the database is first created. Afterward, change the room code through the host UI. Editing `ROOM_CODE` in `.env` does not overwrite an existing database setting.
- `HOST_PASSWORD` and `SESSION_SECRET` always come from `.env`. Changing either requires restarting the app.

## 8. Perform the first deployment

From `/opt/family-feud`, validate the rendered Compose configuration:

```bash
docker compose --env-file .env -f deploy/docker-compose.yml config
```

Make sure the rendered `DOMAIN` is correct. Build and start:

```bash
docker compose --env-file .env -f deploy/docker-compose.yml up -d --build
docker compose --env-file .env -f deploy/docker-compose.yml ps
```

The app should become `healthy`, then Caddy should start. Watch initial logs:

```bash
docker compose --env-file .env -f deploy/docker-compose.yml logs -f \
  --tail=100 app caddy
```

Press `Ctrl-C` to stop following logs; this does not stop the containers.

Verify locally on the Droplet:

```bash
docker compose --env-file .env -f deploy/docker-compose.yml exec -T app \
  node -e "fetch('http://127.0.0.1:3000/health').then(async r => { console.log(r.status, await r.text()); process.exit(r.ok ? 0 : 1) })"
```

Verify HTTPS from the workstation:

```bash
curl -fsS https://feud.example.com/health
```

Then open these routes in a browser:

- `https://feud.example.com/` — player join
- `https://feud.example.com/host` — host controls
- `https://feud.example.com/admin` — question administration
- `https://feud.example.com/display` — read-only TV display

Log in as the host, add a test question, join from two phones, assign one phone to each team, and complete a practice face-off. Restart the app and confirm the question and game state remain:

```bash
cd /opt/family-feud
docker compose --env-file .env -f deploy/docker-compose.yml restart app
docker compose --env-file .env -f deploy/docker-compose.yml ps
```

## 9. Create the GitHub Actions SSH key

Run this section on the administrator workstation, not on the Droplet:

```bash
ssh-keygen -t ed25519 \
  -C "family-feud GitHub Actions" \
  -f ~/.ssh/family-feud-actions \
  -N ""
```

Install only its public key on the Droplet:

```bash
ssh-copy-id -i ~/.ssh/family-feud-actions.pub deploy@203.0.113.10
ssh -i ~/.ssh/family-feud-actions deploy@203.0.113.10 \
  'cd /opt/family-feud && git status --short && docker compose version'
```

The test should print no changed files and should show the Compose version.

The private key is an automation secret. Never commit it, copy it into the repository, or install it on the Droplet.

## 10. Configure GitHub Actions secrets

In GitHub, open **Settings → Secrets and variables → Actions → New repository secret** and add:

| Secret | Value |
| --- | --- |
| `DROPLET_HOST` | Droplet IP address or production hostname |
| `DROPLET_USER` | `deploy` |
| `SSH_PRIVATE_KEY` | Entire contents of `~/.ssh/family-feud-actions`, including the BEGIN and END lines |

`HOST_PASSWORD`, `ROOM_CODE`, `SESSION_SECRET`, and `DOMAIN` are not GitHub Actions secrets for this deployment design. They remain in `/opt/family-feud/.env` on the server.

Delete the GitHub Actions private key from the workstation after storing it in a secure password manager or other approved secret backup:

```bash
rm ~/.ssh/family-feud-actions
```

Keep the `.pub` file if desired; it is not secret.

## 11. Understand continuous delivery

The workflow in `.github/workflows/ci.yml` runs on every push and every pull request:

1. Check out the code.
2. Install pnpm and Node 22.
3. Install dependencies from the lockfile.
4. Run TypeScript checks.
5. Run unit and integration tests.
6. Install Chromium and run Playwright.

The deploy job runs only for a push to `main`, and only after all tests pass. It logs in to the Droplet and runs:

```bash
cd /opt/family-feud
git pull --ff-only
docker compose --env-file .env -f deploy/docker-compose.yml up -d --build
```

The command rebuilds the application and replaces changed containers. It does not delete `.env`, `data/`, or the named Caddy volumes. Additive database migrations run when the app starts.

Recommended delivery process:

1. Create a short-lived branch.
2. Push it and open a pull request.
3. Wait for the `test` job to pass.
4. Review and merge into `main`.
5. Watch the `CI` workflow's deploy job.
6. Verify `/health` and the relevant user path in production.

In GitHub branch protection for `main`, require a pull request and require the `test` status check before merging. This prevents untested code from reaching the deployment branch.

The workflow deliberately skips deployment when `DROPLET_HOST` is absent. If tests pass but no deploy job runs, check that all three repository secrets are set and that the event was a push to `main`.

## 12. Verify a continuous deployment

After the first merge to `main`:

1. Open **GitHub → Actions → CI**.
2. Confirm the `test` job passes.
3. Confirm the `deploy` job passes.
4. On the Droplet, compare the deployed commit:

```bash
cd /opt/family-feud
git rev-parse HEAD
git log -1 --oneline
docker compose --env-file .env -f deploy/docker-compose.yml ps
```

5. From another machine:

```bash
curl -fsS https://feud.example.com/health
```

## 13. Manual deployment

Use this only when GitHub Actions is unavailable or while diagnosing it:

```bash
ssh deploy@203.0.113.10
cd /opt/family-feud
git status --short
git pull --ff-only
docker compose --env-file .env -f deploy/docker-compose.yml up -d --build
docker compose --env-file .env -f deploy/docker-compose.yml ps
curl -fsS https://feud.example.com/health
```

Do not edit tracked source files on the server. A dirty working tree can prevent future automated deployments.

## 14. Back up the database

The database uses SQLite WAL mode. Stop the app briefly before copying `data/` so the database, WAL, and shared-memory files are a consistent set:

```bash
cd /opt/family-feud
sudo install -d -m 700 /var/backups/family-feud
docker compose --env-file .env -f deploy/docker-compose.yml stop app
sudo tar -C /opt/family-feud -czf \
  "/var/backups/family-feud/data-$(date -u +%Y%m%dT%H%M%SZ).tar.gz" \
  data
docker compose --env-file .env -f deploy/docker-compose.yml start app
docker compose --env-file .env -f deploy/docker-compose.yml ps
```

Copy backups to encrypted storage outside the Droplet. A backup that exists only on the same Droplet is not sufficient. Back up `.env` separately in an approved secret manager.

Test restoration periodically on a separate machine or temporary Droplet.

### Restore a database backup

Restoration replaces the current production data. Take a current backup first, then:

```bash
cd /opt/family-feud
docker compose --env-file .env -f deploy/docker-compose.yml down
mv data "data.before-restore-$(date -u +%Y%m%dT%H%M%SZ)"
sudo tar -C /opt/family-feud -xzf /path/to/data-YYYYMMDDTHHMMSSZ.tar.gz
sudo chown -R deploy:deploy data
docker compose --env-file .env -f deploy/docker-compose.yml up -d
docker compose --env-file .env -f deploy/docker-compose.yml ps
```

Do not add `--volumes` to `docker compose down`.

## 15. Roll back application code

First identify the last known-good commit in GitHub. Back up the database before rolling back if the failed release started or changed migrations.

On the Droplet:

```bash
cd /opt/family-feud
git status --short
git fetch origin main
git checkout main
git reset --hard LAST_KNOWN_GOOD_COMMIT
docker compose --env-file .env -f deploy/docker-compose.yml up -d --build
docker compose --env-file .env -f deploy/docker-compose.yml ps
curl -fsS https://feud.example.com/health
```

This is safe only in the dedicated server clone, where no source changes should exist. It does not remove `.env` or `data/`.

Also revert the bad commit in GitHub and merge the revert to `main`. Otherwise the next deployment will reinstall the bad version. Application rollback does not automatically reverse database migrations; migrations are designed to be additive.

## 16. Rotate secrets

### Host password

Edit `HOST_PASSWORD` in `/opt/family-feud/.env`, then recreate the app:

```bash
cd /opt/family-feud
chmod 600 .env
docker compose --env-file .env -f deploy/docker-compose.yml up -d --force-recreate app
```

### Session secret

Changing `SESSION_SECRET` signs out existing host sessions:

```bash
cd /opt/family-feud
docker compose --env-file .env -f deploy/docker-compose.yml up -d --force-recreate app
```

### GitHub Actions SSH key

1. Generate a new workstation key.
2. Add its public key to `/home/deploy/.ssh/authorized_keys`.
3. Replace the `SSH_PRIVATE_KEY` GitHub secret.
4. Run and verify a deployment.
5. Remove the old public key from `authorized_keys`.

### Repository deploy key

1. Generate a new key on the Droplet.
2. Add its public key as a new read-only GitHub deploy key.
3. Update `~/.ssh/config` to use it.
4. Verify with `ssh -T git@github.com` and `git fetch`.
5. Remove the old deploy key from GitHub and its private key from the Droplet.

## 17. Routine operations

Check the service:

```bash
cd /opt/family-feud
docker compose --env-file .env -f deploy/docker-compose.yml ps
docker compose --env-file .env -f deploy/docker-compose.yml logs \
  --tail=100 app caddy
curl -fsS https://feud.example.com/health
```

Check capacity monthly and before a game:

```bash
df -h
docker system df
du -sh /opt/family-feud/data
```

Install operating-system updates:

```bash
sudo apt update
sudo apt upgrade -y
```

If `/var/run/reboot-required` exists, schedule a reboot and verify the containers return because they use `restart: unless-stopped`:

```bash
sudo reboot
```

After reconnecting:

```bash
cd /opt/family-feud
docker compose --env-file .env -f deploy/docker-compose.yml ps
curl -fsS https://feud.example.com/health
```

Remove unused image layers when disk usage grows:

```bash
docker image prune -f
docker builder prune -f
```

Never run `docker compose down --volumes` or `docker system prune --volumes`. Caddy's certificates are in named volumes, and production game data is in `/opt/family-feud/data`.

## 18. Troubleshooting

### Deployment cannot SSH to the Droplet

- Confirm `DROPLET_HOST` and `DROPLET_USER`.
- Confirm the complete private key is in `SSH_PRIVATE_KEY`.
- Confirm the matching public key is one line in `/home/deploy/.ssh/authorized_keys`.
- Check permissions:

```bash
chmod 700 ~/.ssh
chmod 600 ~/.ssh/authorized_keys
```

- Confirm UFW allows OpenSSH and the cloud firewall, if configured, allows TCP 22.

### `git pull` reports permission denied

On the Droplet:

```bash
ssh -T git@github.com
cd /opt/family-feud
git remote -v
git fetch origin main
```

Confirm the repository deploy key still exists in GitHub and its private key matches `~/.ssh/config`.

### `git pull --ff-only` refuses to update

The production clone must remain clean and on `main`:

```bash
cd /opt/family-feud
git status
git branch --show-current
```

Do not delete or overwrite unexpected changes until they are understood. `.env` and `data/` should not appear because they are ignored.

### App is unhealthy

```bash
cd /opt/family-feud
docker compose --env-file .env -f deploy/docker-compose.yml ps
docker compose --env-file .env -f deploy/docker-compose.yml logs \
  --tail=200 app
```

Common causes are missing `.env` values, an unwritable `data/` directory, a failed image build, or an invalid database file. Check ownership with:

```bash
ls -ld /opt/family-feud/data
sudo chown -R deploy:deploy /opt/family-feud/data
```

### HTTPS certificate is not issued

- Confirm the domain's `A` record points to this Droplet.
- Remove an incorrect `AAAA` record.
- Confirm inbound TCP 80 and 443 are open in both UFW and any DigitalOcean cloud firewall.
- Check Caddy:

```bash
cd /opt/family-feud
docker compose --env-file .env -f deploy/docker-compose.yml logs \
  --tail=200 caddy
```

- Confirm `DOMAIN` in `.env` is a hostname, not an `http://` or `https://` URL.

### Tests pass but deployment is skipped

The deploy job runs only on a push to `main`. Confirm `DROPLET_HOST` exists in GitHub Actions repository secrets. Pull-request workflows intentionally test without deploying.

### A deployment completed but the old version is visible

Check the server commit and container creation times:

```bash
cd /opt/family-feud
git log -1 --oneline
docker compose --env-file .env -f deploy/docker-compose.yml ps
docker compose --env-file .env -f deploy/docker-compose.yml images
```

Then force a rebuild if necessary:

```bash
docker compose --env-file .env -f deploy/docker-compose.yml \
  build --no-cache app
docker compose --env-file .env -f deploy/docker-compose.yml up -d app
```

## Pre-event checklist

Complete this on the same Wi-Fi the family will use:

- Production health check succeeds over HTTPS.
- Host password works.
- Room code works from a phone.
- Two phones can join and be assigned to opposite teams.
- The display route works on the TV.
- A practice buzz, reveal, strike, steal, score, and undo all work.
- A fresh off-Droplet database backup exists.
- The latest `main` deployment is green in GitHub Actions.
- The Droplet has adequate disk space and does not require a reboot.
