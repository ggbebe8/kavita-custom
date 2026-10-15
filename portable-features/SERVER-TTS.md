# 서버 TTS 설치·운영·롤백

기존 Kavita 웹 리더와 모든 추가 기능을 유지하고, CPU용 한국어 VITS와 Supertonic 3 음성을 별도 컨테이너에서 생성합니다. Android 앱 설치나 외부 유료 TTS API는 필요하지 않습니다. 브라우저 음성도 선택할 수 있습니다.

## 새 환경에 한 번에 설치

Docker Engine, Compose 플러그인, Python 3, Git을 설치한 Linux/WSL에서 저장소를 내려받은 뒤 실행합니다.

```bash
python3 portable-features/install.py --start
```

기본 경로는 `~/docker/kavita-custom`, 책은 그 안의 `books`, 설정은 `config`, HTTP 포트는 5000입니다. 웹에서 라이브러리 경로 `/books`를 등록합니다. 기존 책·계정·메모를 복원하려면 데이터 백업을 별도로 복원해야 합니다. Git 패키지에는 사용자 데이터가 없습니다. 설치기는 기존 대상 폴더를 덮어쓰지 않습니다.

현재 서버의 책·설정 폴더를 사용해 새 설치 구성을 **생성만** 하는 예시입니다. 같은 폴더의 DB를 사용하는 Kavita 두 개를 동시에 시작하면 안 됩니다.

```bash
python3 portable-features/install.py --target ~/docker/kavita-new \
  --books-dir /mnt/d/Kavita/books --config-dir /mnt/d/Kavita/config
```

경로는 환경에 따라 바꿉니다. WSL 내 설정 폴더를 사용하려면 복원한 Linux 폴더를 `--config-dir`에 지정합니다. 책·config를 생략하면 기본 폴더를 안전하게 만듭니다.

HTTPS까지 새로 구성하려면 설치 명령에 `--https-domain books.example.com`을 추가합니다. 해당 도메인의 DNS와 80/443 접근을 준비해야 하며, 이미 80/443을 사용하는 프록시가 있다면 옵션을 생략하고 기존 프록시를 계속 사용합니다. HTTPS 옵션을 생략해도 설치·웹 읽기·TTS는 가능하지만 PWA 설치·서비스 워커 오프라인 기능은 보안 컨텍스트(HTTPS 또는 localhost)가 필요합니다.

최초 빌드에는 인터넷과 수 분이 필요합니다. 음성 모델 압축 다운로드는 합계 약 196 MB이며 SHA-256을 검증한 뒤 전용 Docker 볼륨에 저장합니다. 이후 재시작 때 모델을 다시 받지 않습니다. 준비 중에는 브라우저 음성을 사용할 수 있습니다. 서버 음성이 준비되면 읽어주기 창을 다시 열어 선택합니다.

## 사용과 동작

온라인 EPUB 리더의 스피커 아이콘 → **서버 음성 · 백그라운드 재생** → 언어·음성·속도 선택 → 재생. 한국어가 기본이며 영어·일본어도 UI에서 선택할 수 있습니다. 기본값은 CPU 사용량이 적은 빠른 한국어 음성이며, 추가로 Supertonic 3 음성 10개를 선택할 수 있습니다. 다른 언어는 Supertonic 음성을 사용합니다.

서버가 문장 단위로 음성을 만들고 같은 MP3 연결에 이어 보냅니다. 다음 문장·다음 목차 구간을 시작할 때 브라우저 타이머가 필요하지 않습니다. 알림·잠금 화면의 재생/일시정지와 준비된 오디오 범위 내 15초 이동은 Media Session을 지원하는 브라우저에서 사용할 수 있습니다. 제조사 배터리 정책·네트워크 단절·브라우저 강제 종료까지 재생을 보장하지 않으며, 실제 Android 화면 꺼짐 검증은 별도로 합니다.

화면이 보일 때 재생 시간을 문장에 맞춰 하이라이트하고 원래 Kavita 이동 기능으로 페이지·목차 구간을 따라갑니다. 화면이 꺼져 UI 실행이 멈췄다면 복귀할 때 듣는 문장으로 따라갑니다. 서버 TTS는 Kavita 읽기 위치나 메모를 직접 수정하지 않습니다. 화면 복귀 후 기존 리더가 위치를 저장합니다. 화면이 꺼진 채 앱을 강제 종료하면 마지막으로 화면에 반영된 위치까지만 남을 수 있습니다.

오프라인 저장본은 기존 브라우저 TTS를 사용합니다. 서버 음성은 서버 연결이 필요하며 현재 음성 파일을 오프라인 책에 영구 내려받는 기능은 포함하지 않습니다. 사용자 페이지 이동은 재생을 정지하고, 다른 기기 위치 충돌을 발견하면 일시정지합니다.

## 데이터·자원

TTS 컨테이너에는 책·config·Docker 소켓을 연결하지 않습니다. 기존 Kavita 인증으로 허용된 EPUB 본문만 읽습니다. JWT는 메모리에만 있고 로그나 음성 캐시에 저장하지 않습니다. 오디오 URL에는 JWT 대신 추측하기 어려운 재생 전용 임시 식별자를 쓰며, 다른 사람에게 공유하면 만료 전 오디오를 들을 수 있으므로 공유하지 않습니다. 문장 목록·세션 제어는 원래 계정 인증이 필요합니다. 프록시는 이 경로의 접근 로그와 브라우저 캐시를 끕니다.

기본 제한은 CPU 2개·RAM 1 GiB, 모델 추론 스레드 2개, 동시 사용자 2명입니다. 합성은 직렬 처리하며 약 90초를 미리 준비한 뒤 속도를 조절합니다. 일시정지하면 선행 생성도 제한합니다. 준비된 음성 캐시는 계정·음성·언어별로 분리하고 마지막 사용 후 14일 또는 총 512 MiB 초과 시 오래된 것부터 정리합니다. 기존 페이지 계산 14일 캐시는 변경하지 않습니다.

진행 중 MP3는 전용 `tts-data` 볼륨에 일시 보관하고 정지·만료 후 정리합니다. 세션은 최대 12시간이며 컨테이너 재시작 시 종료됩니다. 모델과 음성 캐시만 유지합니다. 정지하지 않고 계속 듣는 시간에 따라 임시 파일 사용량도 증가합니다.

```bash
cd ~/docker/kavita-custom
docker compose ps
docker compose logs --tail 30 tts
docker stats --no-stream
```

## 업데이트

배포 폴더를 Git 작업 폴더와 분리합니다. Git에서 원하는 커밋을 선택하고 설치기를 **새 대상 폴더**에 실행하면 기존 파일을 덮어쓰지 않고 검토할 수 있습니다. 기존 운영 환경 전환 전 config 온라인 백업과 Compose·추가 기능 파일 백업을 검증하고, 기존 포트·볼륨·HTTPS 구성을 비교합니다. 이 저장소의 현재 서버는 `compose.swipe.yaml`을 사용하므로 새 설치 예시와 혼동하지 않습니다.

TTS 코드만 바꾸는 경우 생성된 배포 폴더의 `tts` 코드를 갱신한 뒤:

```bash
docker compose -f compose.yaml build tts
docker compose -f compose.yaml up -d --no-deps tts
```

프런트 파일 변경은 프록시의 마운트된 파일에 반영하고 서비스 워커 버전도 함께 갱신합니다. 저장소에서는 `python3 scripts/export-features.py`가 재현용 파일·체크섬·워커 버전을 함께 만듭니다. 캐시 갱신을 위해 온라인에서 새로고침하고 PWA를 닫았다가 엽니다.

## 롤백

가장 빠른 대응은 리더에서 **브라우저 음성**을 선택하는 것입니다. 다른 읽기 기능에는 영향이 없습니다.

새 설치에서 서버 TTS만 비활성화하려면 같은 배포 폴더·같은 Compose 프로젝트 이름으로 실행합니다.

```bash
docker compose -p kavita-custom -f compose.yaml stop tts
docker compose -p kavita-custom -f compose.no-tts.yaml up -d
```

책·config·TTS 볼륨은 삭제하지 않습니다. 다시 활성화하려면 `docker compose -p kavita-custom -f compose.yaml up -d --build`를 실행합니다. `--without-tts` 설치 옵션도 지원합니다.

모든 추가 기능을 제거하고 원래 Kavita만 사용할 때는 프록시를 먼저 중지한 뒤 `compose.original.yaml`을 사용합니다. **서비스 중단이 있으므로 운영 환경에서는 승인과 백업 확인 후 실행합니다.**

```bash
docker compose -p kavita-custom -f compose.yaml stop swipe-proxy tts
docker compose -p kavita-custom -f compose.original.yaml up -d kavita
```

`docker compose down -v`는 사용하지 않습니다. HTTPS를 Caddy로 제공하던 경우 원래 구성으로 전환하면 Caddy의 upstream도 바뀌므로 별도 확인이 필요합니다.

현재 서버의 Git 복구 기준은 `pre-server-tts-20261015` 태그입니다. Git은 코드만 복구하며 DB·계정·메모의 복원 수단이 아닙니다. 작업 중인 변경이 있으면 `git reset --hard` 대신 별도 worktree에서 해당 태그를 꺼내 파일을 비교합니다.

## 실제 기기 확인

1. 온라인에서 새로고침하고 서버 음성을 선택해 본문 중간부터 재생합니다.
2. 한 문장이 화면 페이지 경계를 넘어가도 계속 읽는지 확인합니다.
3. 화면을 끈 채 목차 구간 경계를 포함해 5분 이상 듣습니다.
4. 잠금 화면 일시정지·재개 후 화면을 열어 문장·페이지가 따라오는지 확인합니다.
5. 통화·다른 음악 앱·네트워크 단절 후 동작을 확인합니다. 연결이 끊겼다면 현재 화면에서 재생을 다시 시작합니다.
6. 브라우저 음성·오프라인 읽기·기존 위치 동기화가 유지되는지 확인합니다.

## 출처

- 모델·Python API: https://k2-fsa.github.io/sherpa/onnx/tts/all/Korean/supertonic-3-ko.html
- 모델 원본·라이선스: https://huggingface.co/Supertone/supertonic-3
- 런타임: https://github.com/k2-fsa/sherpa-onnx (Apache-2.0)

Supertonic 모델 배포본의 라이선스 파일은 다운로드 폴더에 함께 보관합니다. 빠른 한국어 음성은 Mycroft Mimic 3 KSS 모델의 ONNX 변환본입니다. 원본 정보·사용 조건은 https://github.com/MycroftAI/mimic3-voices/tree/master/voices/ko_KO/kss_low 에서 확인합니다.

서버 음성의 문장 시작·끝은 생성된 MP3 길이를 기준으로 맞춥니다. 문장 내부의 화면 페이지 이동은 재생 시간에 따른 추정이므로 브라우저 TTS의 단어 경계 이벤트와 정확도가 같지는 않습니다. 음질·속도는 선택한 모델과 서버 CPU에 따라 달라지며, 처음 생성하는 음성의 고배속 재생은 버퍼 대기가 생길 수 있습니다.

## 이번 서버에서 코드까지 되돌리기

서버 TTS 배포 커밋에는 `server-tts-v1` 태그를 붙입니다. 해당 커밋 이후 변경이 없다면 다음 순서로 TTS만 멈추고 Git 역커밋을 만들어 기존 추가 기능 상태로 돌아갑니다. 데이터 볼륨은 그대로 둡니다.

```bash
cd ~/docker/kavita
docker compose -p kavita -f compose.swipe.yaml stop tts
git revert --no-edit server-tts-v1
docker compose -p kavita -f compose.swipe.yaml up -d --no-deps --force-recreate swipe-proxy
```

Git 작성자 설정이 필요할 수 있습니다. 이후 다른 커밋이 쌓였다면 먼저 충돌과 변경 범위를 검토합니다. `git reset --hard`나 데이터베이스 복원은 필요하지 않습니다. Kavita 컨테이너·5000 포트·기존 Caddy는 유지합니다. 파일 바인드 마운트도 이전 코드로 확실히 연결하기 위해 프록시만 재생성하므로 짧은 접속 끊김이 있습니다. 운영에서 실행하기 전 승인을 확인합니다. 온라인 새로고침 후 PWA를 다시 열면 이전 기능 코드가 적용됩니다.
