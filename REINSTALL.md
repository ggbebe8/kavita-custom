서버 TTS를 포함한 새 설치·재배포·롤백 안내는 [SERVER-TTS.md](SERVER-TTS.md)를 참고하세요. 기존 기능과 브라우저 TTS도 유지됩니다.

# Kavita 재설치 매뉴얼

> 수정한 기능만 다른 서버에 적용하려면 [기능 전용 설치 안내](PORTABLE-FEATURES.md)를 사용한다. 이 문서의 reinstall 패키지는 계정·책·DB까지 복원하는 데이터 백업용이다.

작성일: 2026-10-10. 대상: Windows Server + WSL2 Ubuntu 24.04 + Docker Engine/Compose.

이 매뉴얼은 책·기존 계정·읽기 위치·하이라이트·메모와 추가한 스와이프·전체 페이지 표시를 함께 복원한다. 새 계정을 만드는 초기 설치가 아니라 백업 데이터로 복원하는 절차다. 아래에서 E:는 외장 백업 드라이브의 예시다. 실제 드라이브 문자로 바꾼다.

## 1. 복원 방식 선택

| 대상 | A. WSL에 config 저장 | B. 기존처럼 D:에 config 저장 |
|---|---|---|
| 프로젝트·프록시·JS | `~/docker/kavita` | `~/docker/kavita` |
| config·DB | `~/docker/kavita/config` | `D:\Kavita\config` |
| 책 | `D:\Kavita\books` | `D:\Kavita\books` |
| 복원 방식 | 복원 스크립트가 바로 실행 | 파일 복원 후 config 경로 변경·실행 |

A는 config를 Linux 파일시스템에 두는 선택이고 B는 현재 서버와 같은 배치다. 스와이프·페이지 표시 기능은 두 방식 모두 동일하다. A/B 중 하나만 진행한다. 현재 운영 구성은 이 매뉴얼을 작성하는 작업으로 변경되지 않았다.

## 2. 포맷 전에 최신 백업 만들기

**현재 서버의 WSL Ubuntu 터미널**에서 실행한다.

```bash
cd ~/docker/kavita
python3 scripts/backup-kavita.py
```

서비스를 중단하지 않고 SQLite 온라인 백업과 DB 무결성 검사를 수행한다. 모든 파일의 SHA-256 체크섬도 검증한다. 백업 중 책 파일과 일반 config 파일은 편집하지 않는다. 로그/cache와 두 DB 모두가 하나의 시점에 고정되는 스냅샷은 아니다.

생성된 `~/docker/kavita/reinstall` 폴더 **전체**를 외장 디스크나 다른 서버로 복사한다. Windows 탐색기에서는 아래 경로로 접근할 수 있다. 배포판 이름과 Linux 사용자는 자신의 환경에 맞춘다.

```text
\\wsl.localhost\Ubuntu-24.04\home\achops1368\docker\kavita\reinstall
```

배포판 이름을 모르면 **Windows PowerShell**에서 `wsl -l -v`로 확인한다. 복사본에 아래 파일이 있는지 확인한다.

```text
E:\reinstall\
  restore-kavita.py
  REINSTALL.md
  LATEST
  kavita-날짜.tar.gz
  kavita-날짜.tar.gz.sha256
```

이전 날짜의 패키지가 함께 있어도 된다. `LATEST`는 가장 최근에 검증된 패키지를 가리킨다. 패키지에는 책과 계정·메모 정보가 들어 있으므로 비공개로 보관한다. **포맷할 디스크 안의 복사본만 남기지 않는다.** 이후 새 메모나 읽기 위치가 생기면 포맷 직전에 백업을 다시 만든다.

외부 복사본 검증은 **WSL Ubuntu**에서 실행한다.

```bash
python3 /mnt/e/reinstall/restore-kavita.py --verify-only
```

`Archive and all file checksums verified.`가 출력되어야 한다. 이 명령은 파일 복원이나 컨테이너 실행을 하지 않는다. 백업과 별도로 현재 SSH 서버 주소·사용자·키·포트포워딩 명령, Windows 자동 시작 작업의 실행 계정과 설정도 기록한다. 이 항목은 패키지에 포함되지 않는다.

## 3. 새 Windows에서 WSL Ubuntu 설치

이미 WSL2 Ubuntu 24.04가 설치되어 있으면 이 단계를 건너뛴다. **관리자 Windows PowerShell**에서 실행한다.

```powershell
wsl --install -d Ubuntu-24.04
```

요청되면 Windows를 재부팅한다. Ubuntu를 한 번 실행해 Linux 사용자 이름과 비밀번호를 만든다. **Windows PowerShell**에서 확인한다.

```powershell
wsl --update
wsl -l -v
```

목록의 Ubuntu 배포판 VERSION이 2인지 확인한다. 1이면 실제 배포판 이름으로 다음을 실행한다.

```powershell
wsl --set-version Ubuntu-24.04 2
```

Windows Server 2022/2025는 간단한 WSL 설치 방식을 지원한다. 구버전 Server나 Server Core에서 위 명령이 지원되지 않으면 해당 버전의 Microsoft 설치 절차를 따른다. [Windows Server WSL 설치](https://learn.microsoft.com/en-us/windows/wsl/install-on-server), [수동 설치](https://learn.microsoft.com/en-us/windows/wsl/install-manual).

## 4. WSL의 systemd와 Docker 준비

이후 명령은 별도 표시가 없으면 **WSL Ubuntu 터미널**에서 일반 Linux 사용자로 실행한다. 복원 스크립트 자체를 `sudo python3`로 실행하면 프로젝트 기본 위치가 `/root`가 되므로 사용하지 않는다.

먼저 systemd를 확인한다.

```bash
ps -p 1 -o comm=
cat /etc/wsl.conf
```

첫 명령이 `systemd`면 다음 Docker 설치로 진행한다. systemd가 아니라면 `/etc/wsl.conf`를 편집한다.

```bash
sudo nano /etc/wsl.conf
```

기존 설정을 유지하고 다음 항목을 추가하거나 기존 값을 변경한다. 이미 `[boot]`가 있으면 그 아래에 넣고 섹션을 중복해서 만들지 않는다.

```ini
[boot]
systemd=true
```

WSL을 다시 시작해야 적용된다. **Windows PowerShell**에서 아래 명령을 실행한 뒤 Ubuntu를 다시 연다. 이 명령은 실행 중인 모든 WSL 배포판을 종료하므로 새 설치를 준비하는 시점에 실행한다. [Microsoft systemd 안내](https://learn.microsoft.com/en-us/windows/wsl/systemd)

```powershell
wsl --shutdown
```

Docker Engine과 Compose가 이미 설치되어 정상 동작한다면 설치 명령을 건너뛴다. **새 Ubuntu 24.04 설치**에서는 다음을 실행한다. 기존 Docker 설치나 다른 컨테이너가 있는 환경에서 재설치 명령을 그대로 실행하지 않는다. [Docker 공식 Ubuntu 설치 안내](https://docs.docker.com/engine/install/ubuntu/)

```bash
sudo apt update
sudo apt install -y ca-certificates curl python3
sudo install -m 0755 -d /etc/apt/keyrings
sudo curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
sudo chmod a+r /etc/apt/keyrings/docker.asc

sudo tee /etc/apt/sources.list.d/docker.sources > /dev/null <<EOF_DOCKER
Types: deb
URIs: https://download.docker.com/linux/ubuntu
Suites: noble
Components: stable
Architectures: $(dpkg --print-architecture)
Signed-By: /etc/apt/keyrings/docker.asc
EOF_DOCKER

sudo apt update
sudo apt install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
sudo systemctl enable --now docker
sudo usermod -aG docker "$USER"
```

Docker 그룹 변경을 반영하려면 Ubuntu에서 `exit`로 나간 뒤 다시 연다. 반영되지 않으면 새 Ubuntu 터미널에서 `newgrp docker`를 실행한다. Docker 그룹은 호스트 관리 권한을 가진다. 일반 사용자로 아래 명령이 성공해야 한다.

```bash
docker info --format '{{.ServerVersion}}'
docker compose version
systemctl is-enabled docker
python3 --version
```

Python은 Ubuntu 24.04 기본 버전인 3.12를 사용한다. `permission denied`가 나오면 그룹 설정을 확인한 뒤 진행한다.

## 5. 드라이브와 백업 확인

**WSL Ubuntu**에서 실행한다.

```bash
mountpoint /mnt/d
ls -ld /mnt/d /mnt/e/reinstall
python3 /mnt/e/reinstall/restore-kavita.py --verify-only
```

D:가 없으면 먼저 드라이브를 준비한다. 책을 다른 드라이브에 둘 경우 복원 명령에 `--books-dir /mnt/실제드라이브/Kavita/books`를 지정한다.

복원 대상인 `~/docker/kavita`가 이미 존재하면 스크립트는 중단한다. 삭제해서 재시도하지 말고 내용을 확인하거나 `--project-dir ~/docker/kavita-restored`로 새 폴더를 지정한다. 이후 명령의 프로젝트 경로도 그에 맞게 바꾼다. 기존 Kavita 컨테이너 역시 자동으로 교체하지 않는다.

## 6A. config를 WSL 내부에 두기: 명령 하나로 복원

```bash
python3 /mnt/e/reinstall/restore-kavita.py
```

백업 검증, 파일 복원, SQLite 무결성 검사, 고정 Docker 이미지 다운로드, 컨테이너 실행까지 진행한다.

- config: `~/docker/kavita/config`
- 책: `/mnt/d/Kavita/books`
- 서비스: `http://localhost:5000`

D:에 책이 남아 있으면 패키지의 책과 해시를 확인해 재사용한다. 다르면 덮어쓰지 않고 중단한다. 이미지 다운로드에는 인터넷이 필요하다. 완료하면 7번으로 진행한다.

## 6B. 기존처럼 config를 D:에 두기

먼저 컨테이너를 실행하지 않고 파일만 복원한다.

```bash
python3 /mnt/e/reinstall/restore-kavita.py --extract-only
```

다음 블록은 **새로 복원한 프로젝트**에서 실행한다. config를 D:에 복사하고 두 Compose 파일의 마운트를 변경한다. D:에 기존 config가 있으면 덮어쓰지 않고 중단한다.

```bash
cd ~/docker/kavita
python3 - <<'PY_CONFIG'
from pathlib import Path
import shutil

source = Path('config')
destination = Path('/mnt/d/Kavita/config')
if destination.exists():
    raise SystemExit('D:에 config가 이미 있습니다. 덮어쓰지 않고 중단합니다.')
paths = [Path('compose.swipe.yaml'), Path('compose.yaml')]
for path in paths:
    if path.read_text().count('./config:/kavita/config') != 1:
        raise SystemExit('Compose의 config 설정이 예상과 달라 중단합니다.')
shutil.copytree(source, destination)
for path in paths:
    path.write_text(path.read_text().replace('./config:/kavita/config', '/mnt/d/Kavita/config:/kavita/config'))
print('config를 D:에 복사하고 Compose를 변경했습니다. WSL의 복사본도 보관합니다.')
PY_CONFIG
```

블록이 성공한 경우에만 다음을 실행한다.

```bash
docker compose -p kavita -f compose.swipe.yaml config --quiet
docker compose -p kavita -f compose.swipe.yaml pull --ignore-buildable
docker compose -p kavita -f compose.swipe.yaml up -d --build
```

D:에 config가 이미 남아 있으면 백업보다 최신 데이터일 수 있다. 먼저 기존 config를 외부에 백업하고 어느 DB를 사용할지 확인한 뒤 진행한다. 이 경우 위 복사 블록을 강제로 실행하지 않는다. Compose의 마운트는 다음 형태가 되어야 한다.

```yaml
volumes:
  - /mnt/d/Kavita/books:/books
  - /mnt/d/Kavita/config:/kavita/config
```

WSL에 복원한 config는 예비 복사본으로 남고, 서비스는 D:의 config만 갱신한다. 백업 스크립트는 실제 컨테이너의 마운트를 확인해 사용 중인 config를 백업한다.

## 7. 서비스와 기능 확인

```bash
cd ~/docker/kavita
docker compose -p kavita -f compose.swipe.yaml ps
curl -fsS http://localhost:5000/api/health
curl -fsS http://localhost:5000/ | grep kavita-swipe.js
```

시작 직후에는 준비 시간이 필요할 수 있다. Kavita가 `healthy`, 프록시가 실행 중이고 health가 `Ok`를 반환하는지 확인한다. 기존 URL 또는 SSH 터널로 접속한 뒤 아래를 확인한다.

1. 초기 등록 화면이 아닌 기존 계정으로 로그인된다.
2. 책, 읽기 위치, 하이라이트와 메모가 복원되어 있다.
3. EPUB 1열/2열에서 왼쪽 스와이프는 다음, 오른쪽은 이전 페이지로 이동한다.
4. 메뉴를 숨긴 몰입 모드에서도 스와이프가 된다.
5. 오른쪽 아래 전체 페이지 표시가 계산 후 숫자로 바뀐다. 긴 책은 시간이 걸릴 수 있다.
6. 메모 입력·텍스트 선택·목차·설정에서는 스와이프가 페이지를 바꾸지 않는다.
7. PC 클릭·키보드, PDF와 세로 스크롤도 정상이다.

**반드시 `compose.swipe.yaml`로 실행한다.** `compose.yaml`은 추가 기능 없는 롤백용이다. 두 파일을 동시에 `-f`로 지정하지 않는다.

## 8. SSH 포트포워딩 복원

기록한 기존 SSH 서버·사용자·키·접속 포트와 터널 명령을 복원한다. 서비스 포트는 기존과 같은 5000이다. 클라이언트에서 실행하는 예시:

```bash
ssh -N -L 15000:127.0.0.1:5000 SSH사용자@SSH서버
```

이 예시는 **SSH 서버에서 `127.0.0.1:5000`에 도달할 수 있는 경우**에 사용한다. 터널을 유지한 채 클라이언트의 `http://127.0.0.1:15000`에 접속한다. SSH를 Windows에서 받는지 WSL에서 받는지에 따라 전달 대상이 달라지므로 기존 구성을 우선한다. WSL IP는 재부팅 후 바뀔 수 있다. SSH 서버·키·방화벽 설정은 복원 패키지에 포함되지 않는다.

## 9. Windows 재부팅 후 자동 시작

두 컨테이너에는 `restart: unless-stopped`가 포함되어 있다. WSL에서 Docker 자동 시작을 확인한다.

```bash
systemctl is-enabled docker
```

`enabled`가 아니면 실행한다.

```bash
sudo systemctl enable docker
```

Docker가 시작될 때의 컨테이너 자동 재시작과 Windows가 켜질 때의 WSL 실행은 별개다. 우선 이전 Windows 작업 스케줄러 설정을 복원한다.

기존 작업이 없는 경우 설정 예시:

- 실행 계정: WSL을 설치한 **동일한 Windows 계정**. SYSTEM 계정으로 바꾸지 않는다.
- 트리거: 먼저 로그온 시 실행으로 확인한다. 로그온 전 실행이 필요하면 시스템 시작 시 트리거와 해당 계정으로 로그온 여부와 관계없이 실행하는 설정을 사용하고 실제 재부팅으로 검증한다.
- 프로그램: `C:\Windows\System32\wsl.exe`
- 인수: 실제 배포판 이름으로 아래 값을 지정한다.

```text
-d Ubuntu-24.04 -u root --exec /bin/bash -lc "systemctl start docker && exec sleep infinity"
```

WSL과 Docker를 시작하고 프로세스를 유지하는 예시다. 일정 시간 후 작업 중지 설정은 끄고, 이미 실행 중이면 새 인스턴스를 시작하지 않도록 설정한다. 기존 작업이 Compose를 직접 실행한다면 `compose.swipe.yaml`과 실제 프로젝트 경로를 사용하도록 수정한다.

계획한 중단 시간에 Windows를 재부팅하고 D: 마운트, WSL, Docker, 두 컨테이너, health와 SSH 접속을 확인한다. 이 작업 스케줄러 예시는 실제 Windows에서 자동 검증하지 않았다.

## 10. 문제 해결

| 증상 | 조치 |
|---|---|
| 백업 파일이 없음 | 드라이브 문자, `LATEST`, `.tar.gz`와 `.sha256` 확인 |
| checksum mismatch | 중단하고 정상 백업을 다시 복사. 체크섬을 임의로 고치지 않음 |
| project directory already exists | 삭제하지 않고 내용 확인 또는 새 `--project-dir` 지정 |
| Existing Kavita container detected | 기존 서비스 확인. 자동 교체하지 않음 |
| Existing books differ | 기존 책을 보존하고 새 `--books-dir`에 복원 |
| Docker permission denied | Docker 그룹과 새 로그인 세션 확인 |
| Port 5000 is already allocated | 해당 포트의 기존 서비스 확인 |
| 신규 계정 등록 화면이 나옴 | 새 계정을 만들지 말고 config·DB 마운트 확인 |
| 스와이프·숫자가 안 나옴 | 새로고침, JS 주입, 1열/2열, 활성 Compose 파일 확인 |
| pull/up 중 실패 | 복원 파일은 남아 있음. 원인 해결 후 아래 명령 재실행 |

```bash
cd ~/docker/kavita
docker compose -p kavita -f compose.swipe.yaml config --quiet
docker compose -p kavita -f compose.swipe.yaml pull --ignore-buildable
docker compose -p kavita -f compose.swipe.yaml up -d --build
```

파일을 복원한 뒤 실행 실패한 경우, 프로젝트가 이미 있으므로 복원 스크립트를 다시 실행하는 대신 위 Compose 명령을 사용한다. 진단 명령:

```bash
docker inspect kavita --format '{{range .Mounts}}{{.Source}} -> {{.Destination}}{{println}}{{end}}'
docker compose -p kavita -f compose.swipe.yaml logs --tail 30 kavita
```

로그를 공유할 때는 인증정보·토큰·개인 데이터를 제외한다.

## 11. 추가 기능만 롤백

프록시 또는 추가 기능에 문제가 있으면 config·DB를 교환하지 않고 원본 구성으로 직접 Kavita를 5000 포트에 공개할 수 있다. 잠시 접속이 끊기는 작업이므로 이용을 멈춘 뒤 실행한다.

```bash
cd ~/docker/kavita
docker compose -p kavita -f compose.swipe.yaml stop swipe-proxy
docker compose -p kavita -f compose.swipe.yaml rm -f swipe-proxy
docker compose -p kavita -f compose.yaml up -d --pull never kavita
curl -fsS http://localhost:5000/api/health
```

패키지의 두 Compose 파일은 동일 config와 고정된 Kavita 이미지를 참조하도록 준비되어 있다. `down -v`, 책·DB·볼륨 삭제는 사용하지 않는다. 오래된 DB 복원은 최근 메모와 읽기 위치를 되돌리므로 프록시 롤백에는 DB 복원을 사용하지 않는다.

## 12. 검증 범위

백업의 모든 파일 체크섬을 검증했다. 복원 스크립트는 임시 폴더에 파일을 복원해 SQLite 무결성, config의 WSL 배치, Compose 문법, 기존 데이터 보호, 손상된 패키지 차단을 검사했다. 스와이프와 전체 페이지 표시의 테스트 결과는 `README.swipe.md`에 있다.

새 Windows 설치, 작업 스케줄러, 재부팅 후 자동 접속 및 실제 터치 기기는 자동 검증하지 않았다. 위 수동 확인을 진행한다. 현재 운영 서비스의 포트·마운트·컨테이너는 매뉴얼 작성 과정에서 변경하지 않았다.

현재 서버의 자동 시작 장애 수정 기록과 실제 적용 설정은 `scripts/WSL-AUTOSTART.md`에 정리했다. 새 서버에서는 드라이브/배포판/계정을 해당 환경에 맞춰 조정한다.
