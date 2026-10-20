# Kavita Custom

**스와이프로 읽고, 오프라인으로 보관하고, TTS로 듣는 Kavita EPUB 리더.**

[Kavita](https://github.com/Kareadita/Kavita)의 공식 Docker 이미지에 웹 리더 개선 기능을 더한 커스터마이징 프로젝트입니다. Nginx를 통해 기능을 추가하고, Docker Compose로 Kavita·프록시·서버 TTS를 함께 설치합니다.

Android에서 시작한 스와이프 기능을 Windows·Linux 터치 브라우저까지 확장했습니다. PC에서는 마우스로 기존 리더를 사용할 수 있습니다.

## 무엇을 커스텀했나요?

| 기능 | 추가한 내용 |
|---|---|
| **스와이프 페이지 넘김** | 왼쪽은 다음 페이지, 오른쪽은 이전 페이지. 집중 모드에서도 동작하며 연속 입력을 처리합니다. 텍스트 선택·메모·설정·다중 터치와의 충돌을 줄였습니다. |
| **높이에 따른 터치 영역** | 좌우 가장자리 영역의 위쪽 1/3은 이전 페이지, 아래쪽 2/3은 다음 페이지로 이동합니다. 가운데 메뉴 영역은 유지하며 설정에서 켜고 끕니다. |
| **전체 화면 페이지 계산** | 현재 화면 크기·글꼴을 기준으로 책 전체 페이지를 계산합니다. `183/450 (40%)`처럼 표시하고, 숫자를 눌러 원하는 페이지로 이동합니다. 계산 결과는 14일간 캐시합니다. |
| **하단 정보 표시** | 하단에 목차 제목, 전체 페이지 기준 진행률, 현재 장 진행정보(`218/450(48%)(17/24)`)를 표시합니다. 하위 옵션으로 목차, 전체페이지정보, 진행률, 진행정보, 집중 모드 표시를 각각 선택할 수 있으며, 하단 목차를 클릭하면 목차 메뉴(Table of Contents)를 바로 열 수 있습니다. |
| **읽던 위치 복원·동기화 안내** | 장의 시작으로 돌아가는 현상을 보완하고 본문 위치를 복원합니다. 다른 브라우저에서 읽기 위치가 바뀌면 다음 읽기 동작 전에 최신 위치로 이동할지 묻습니다. |
| **전체화면 버튼** | 상단 단축키 아이콘 옆에서 전체화면을 켜고 끕니다. |
| **PWA·오프라인 책장** | 책 상세 화면에서 EPUB을 저장하고, 오프라인에서도 기존 Kavita 리더로 읽습니다. 저장 완료 상태를 구분하며, 재연결하면 읽기 위치·하이라이트·메모 변경을 동기화하고 충돌을 확인합니다. |
| **브라우저 TTS** | 브라우저 음성으로 읽으며 현재 문장을 하이라이트합니다. 화면 페이지와 다음 목차 구간을 따라 이어 읽습니다. |
| **서버 TTS** | 자연스러운 신경망 음성(Edge-TTS: 선희·인준·현수 등)을 하나의 연속 MP3로 전달합니다. 사람이 책을 읽어주는 듯한 자연스러운 한국어 발음과 억양, 속도 조절, 지원 브라우저의 잠금 화면 재생 제어를 제공합니다. |
| **리더 동작 보완** | 이미지가 넘쳐 페이지를 넘기지 못하는 문제, 불필요한 북마크 표시, 페이지 이동 시 집중 모드가 풀리는 현상 등을 보완했습니다. |

## 빠른 설치

Linux 또는 Windows WSL 환경에서 **Docker Engine, Docker Compose 플러그인, Git**을 준비합니다. 최초 설치에는 이미지 다운로드 및 Edge-TTS 모델 빌드를 위한 인터넷 연결이 필요합니다.

### 방법 1. 무지성 원클릭 설치 (가장 쉬운 기본 설치)

환경변수 설정 없이도 기본값(사용자 홈 디렉토리의 `~/kavita`)으로 바로 구동할 수 있습니다.

```bash
git clone https://github.com/ggbebe8/kavita-custom.git
cd kavita-custom

# 아무 설정 없이 한방에 빌드 및 실행!
docker compose up -d --build
```

- 구동 후 웹 브라우저에서 `http://서버IP:5000` 으로 접속합니다.
- 책 파일은 `~/kavita/books` 폴더에 넣고, Kavita 웹에서 라이브러리 추가 시 폴더 경로를 `/books` 로 지정합니다.
- 설정 및 SQLite DB는 `~/kavita/config`에 자동 보관됩니다.

### 방법 2. 저장 경로 및 포트 사용자 지정 (환경변수 설정)

책 폴더 위치(`D:\...` 등)나 포트를 변경하고 싶다면 `.env` 파일을 복사하여 수정한 뒤 실행합니다.

```bash
cp .env.example .env
nano .env   # 원하는 경로 및 포트로 수정
docker compose up -d --build
```

#### 조정 가능한 환경변수 목록

| 환경변수 | 기본값 | 설명 |
|---|---|---|
| `BOOKS_PATH` | `~/kavita/books` | 호스트의 책(EPUB, CBZ 등) 저장 폴더 경로 |
| `CONFIG_PATH` | `~/kavita/config` | Kavita 설정 및 SQLite DB 데이터 저장 경로 |
| `PORT` | `5000` | 웹 접속 포트 (`http://서버IP:5000`) |
| `TZ` | `Asia/Seoul` | 컨테이너 시간대 (기본: 한국 표준시) |
| `TTS_THREADS` | `2` | Edge-TTS 동시 음성 변환 스레드 수 |
| `TTS_CACHE_MB` | `512` | 서버 TTS 음성 파일 캐시 용량 (MB) |

### 방법 3. 자동 배포 스크립트 사용

Python 3.12 이상이 설치되어 있다면 자동 설정 스크립트로 독립된 폴더에 구성할 수도 있습니다.

```bash
python3 portable-features/install.py --start
```

---

## 프록시(Proxy) 설정 가이드

### 1. 내부 프록시 (`swipe-proxy` - 자동 구동)
- **사용자가 따로 설정할 것이 없습니다.** `docker compose up` 실행 시 Nginx 기반의 `swipe-proxy`가 함께 실행됩니다.
- 이 내부 프록시가 포트 `5000`에서 요청을 받아:
  - Kavita 웹 리더에 **스와이프 제스처 JS (`swipe.js`) 자동 주입**
  - `/tts/...` 요청을 **Edge-TTS 서버로 라우팅**
  - `/kavita-pwa/...` 요청을 **오프라인 책장 및 PWA 파일로 서빙**
- 따라서 로컬 및 사내망에서는 `http://서버IP:5000`으로 접속하기만 하면 모든 커스텀 기능이 자동으로 작동합니다.

### 2. 외부 역방향 프록시 (HTTPS / 외부 도메인 연결 시)
Nginx Proxy Manager(NPM), Caddy, Nginx, Cloudflare Tunnel, Synology Reverse Proxy 등을 통해 외부 도메인(`https://books.example.com`)을 연결할 때는 포트 `5000`을 바라보도록 설정합니다.

> [!IMPORTANT]
> **WebSocket 지원 필수**: Kavita의 실시간 읽기 진행 동기화 및 알림을 위해 프록시 설정에서 WebSocket(Upgrade 헤더)을 반드시 켜주어야 합니다.

#### Nginx 설정 예시
```nginx
server {
    listen 443 ssl http2;
    server_name books.example.com;

    ssl_certificate /etc/letsencrypt/live/books.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/books.example.com/privkey.pem;

    client_max_body_size 0; # 대용량 책 업로드 제한 해제

    location / {
        proxy_pass http://127.0.0.1:5000;
        proxy_http_version 1.1;

        # WebSocket 및 프록시 필수 헤더
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

#### Caddyfile 설정 예시
```caddy
books.example.com {
    reverse_proxy 127.0.0.1:5000
}
```

#### Nginx Proxy Manager (NPM) 설정 시
- **Forward Hostname / IP**: `127.0.0.1` (또는 호스트 IP)
- **Forward Port**: `5000`
- **Websockets Support**: **반드시 체크 (On)**
- **Block Common Exploits**: 체크 (On)
- **SSL 탭**: `Force SSL`, `HTTP/2 Support` 체크

## 설치 후 사용하기

- **페이지 이동:** EPUB을 열어 좌우로 스와이프하거나 하단 페이지 숫자를 눌러 이동합니다.
- **추가 읽기 설정:** 리더 설정의 글자 크기 아래에서 높이별 페이지 넘김과 목차·진행률 표시를 선택합니다.
- **오프라인 읽기:** 책 상세 화면에서 오프라인 저장을 누르고 준비가 끝나면 오프라인 책장에서 엽니다.
- **듣기:** 리더 상단 스피커 아이콘을 눌러 브라우저 음성 또는 서버 음성을 선택합니다.

## 동작 범위

- 주요 추가 기능은 EPUB 리더를 대상으로 합니다. 스와이프·높이별 터치 페이지 넘김은 PDF와 세로 스크롤 모드에 적용하지 않습니다.
- 화면 크기·글꼴이 달라지면 계산된 페이지 수도 달라집니다. 추가 옵션과 오프라인 저장본은 브라우저·프로필·접속 주소별로 관리됩니다.
- 서버 TTS는 온라인 연결이 필요합니다. 화면 꺼짐 재생은 기기·브라우저의 배터리 정책에 영향을 받으며, 실제 Android 기기의 장시간 재생은 별도 확인이 필요합니다. 서버 음성의 문장 내부 페이지 이동은 재생 시간에 따른 추정입니다.
- 오프라인 변경은 재연결 시 충돌을 확인합니다. 사이트 데이터 삭제나 브라우저 저장 공간 정리로 기기 보관분이 사라질 수 있으므로 중요한 미동기화 메모는 내보내기로 보관하세요.
- 배포용 Kavita·Nginx 이미지는 digest로 고정합니다. 다른 Kavita 버전으로 변경할 때는 리더 구조와 추가 기능의 호환성을 확인해야 합니다.

## 저장소 구성

```text
portable-features/   새 환경 설치에 필요한 배포 패키지
proxy/               리더 추가 기능, PWA·오프라인 화면, Nginx 설정
tts/                 서버 음성 생성·스트리밍 서비스
scripts/             패키지 생성, 설치 구성, 데이터 백업·복원
tests/               기능별 회귀 테스트
```

**설치만 할 때는 `portable-features/` 폴더 전체가 있으면 됩니다.** 유지보수와 기능 개발에는 원본 코드·테스트·문서를 포함한 전체 저장소를 사용합니다. 책·개인 설정·DB·인증정보는 배포 패키지에 포함하지 않습니다.

## 상세 문서

| 문서 | 내용 |
|---|---|
| [설치·재배포](portable-features/README.md) | 짧은 설치 요약과 상세 옵션 |
| [오프라인 읽기](OFFLINE.md) | 저장·동기화·충돌 처리·기기 보관 정책 |
| [서버 TTS](SERVER-TTS.md) | 음성 선택·자원 제한·업데이트·롤백 |
| [리더 커스터마이징](README.swipe.md) | 추가 기능의 구현·운영 상세 |
| [데이터 포함 재설치](REINSTALL.md) | 책·config 백업과 복원 |
| [AI 유지보수 안내](AI유지보수.md) | 새 AI 세션에서 조사·개발·검증할 때의 기준 |

기능을 수정한 뒤에는 `python3 scripts/export-features.py`로 설치 패키지와 체크섬을 함께 갱신합니다. 롤백 절차는 각 기능 문서에 있으며, Git의 코드 복구와 사용자 데이터 복원은 별개입니다.

## 기반 프로젝트

- [Kavita](https://github.com/Kareadita/Kavita)
- [Nginx](https://nginx.org/) · [Caddy](https://caddyserver.com/)
- [edge-tts](https://github.com/rany2/edge-tts) · [Microsoft Neural Voices](https://azure.microsoft.com/services/cognitive-services/text-to-speech/) · [FFmpeg](https://ffmpeg.org/)

각 기반 프로젝트와 음성 모델의 라이선스는 해당 원본을 따릅니다.
