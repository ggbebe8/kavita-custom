# 현재 Windows 서버의 WSL 자동 시작 수정 기록

2026-10-11 기준, Windows 예약 작업 `WSL Auto Start`는 WSL Ubuntu를 켜고 Docker 서비스가 계속 실행될 수 있도록 WSL을 유지한다. 컨테이너 자체의 `unless-stopped`는 Docker가 실행되는 동안 적용되며 WSL 자체의 종료를 막지는 않는다.

조사 결과 Windows 부팅 이후 WSL이 여러 번 다시 시작됐고, 기존 자동 시작 작업은 결과 코드 1로 종료된 채 재시도하지 않고 있었다. 이전 실행의 자세한 오류는 기록이 없어 확정하지 못했다. 기존 작업은 Password 로그온 방식이었으며 설정 변경에서도 계정 인증이 거부됐다.

수정 사항:

- 기존 작업 XML을 `backups/wsl-autostart/original-task.xml`과 `D:\Kavita\startup\original-task.xml`에 보관했다.
- 동일 Windows 계정의 S4U 로그온 방식으로 변경해 암호 입력 없이 실행한다.
- 기존 부팅 트리거를 유지하고, 실행 가능해지면 시작하는 설정을 적용했다.
- 실행 시간 제한을 없애고 중복 실행을 막았다.
- 실패 시 1분 간격으로 최대 3회 작업을 재시작한다.
- 작업은 `D:\Kavita\startup\keep-wsl-running.ps1`을 실행한다. Linux에서 foreground `sleep infinity`를 실행해 WSL을 유지하고, 명령이 끝나면 15초 후 다시 시도한다.
- Docker는 WSL에서 이미 systemd 자동 시작(enabled) 설정이다. 유지 프로세스는 Docker 시작 명령의 일시적인 실패와 독립적으로 동작한다.

실행 인수:

```text
-NoProfile -NonInteractive -ExecutionPolicy Bypass -File "D:\Kavita\startup\keep-wsl-running.ps1"
```

프로그램은 Windows의 `System32\WindowsPowerShell\v1.0\powershell.exe`다. 스크립트 원본은 이 프로젝트의 `scripts/keep-wsl-running.ps1`이다. 진단 로그는 `D:\Kavita\startup\keep-wsl-running.log`에 기록한다. S4U는 Windows의 네트워크 공유/암호화 파일 접근에 제약이 있으므로 네트워크 드라이브에 스크립트를 두는 구성은 별도로 검증한다.

확인 명령(Windows PowerShell):

```powershell
Get-ScheduledTask -TaskName 'WSL Auto Start' | Select-Object TaskName, State
Get-ScheduledTask -TaskName 'WSL Auto Start' | Get-ScheduledTaskInfo
Get-Content D:\Kavita\startup\keep-wsl-running.log -Tail 10
```

작업이 실행 중일 때 LastTaskResult 267009(0x41301)는 오류가 아니라 실행 중 상태다. 작업 Running, Linux 유지 프로세스, 내부/외부 health HTTP 200을 확인했다. Windows 재부팅이나 로그오프 후 유지 여부는 실제 재부팅 테스트를 하지 않았으므로 별도로 확인해야 한다.

이번 수정에서 Kavita 이미지·데이터·포트·컨테이너를 변경하거나 재시작하지 않았다. 설정을 되돌리려면 예약 작업의 실행 계정/인수/설정을 원본 XML 기준으로 복구한다. Password 방식 복원에는 Windows 계정의 정상 자격 증명이 필요할 수 있다. 유지 작업을 중지하면 WSL이 다시 유휴 종료될 수 있으므로 운영 중 무작정 중지하지 않는다.
