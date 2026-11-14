# Phlegon

**브라우저를 버벅이게 만드는 코드를 피하고, 필요한 성능 검증을 빠뜨리지 않도록 하는 코딩 지침.**

> 빨라졌다며? 재봐.

## 하는 일

- 메인 스레드 연산, 반복 이벤트, DOM·렌더링 비용을 살핍니다.
- 불필요한 작업 제거와 기존 구현 재사용부터 검토합니다.
- 기능과 접근성을 보존하고, 성능 개선은 실행·측정 근거로 확인합니다.
- 단순 문구·색상 변경에는 불필요한 성능 검사를 추가하지 않습니다.

## 설치와 사용

필요한 형태 하나를 선택하십시오. 네 형태 모두 루트 [SKILL.md](SKILL.md)의 성능 지침을 사용합니다.

| 형태 | 선택할 때 | 호출 |
| --- | --- | --- |
| 기존 Codex 스킬 | 현재 대화에 지침 적용 | `$phlegon` |
| Claude Code 플러그인 | 별도 에이전트에 작업 위임 | `phlegon:phlegon` 에이전트 지정 |
| Codex 프로젝트 에이전트 | 해당 프로젝트에서 작업 위임 | `phlegon` 에이전트 지정 |
| 터미널 CLI | 설치된 실행기로 한 요청 실행 | `phlegon --engine codex\|claude` |

### 1. 기존 Codex 스킬

Codex의 기본 스킬 경로에 설치합니다. 같은 경로에 이미 설치되어 있다면 중복 설치할 필요가 없습니다.

```bash
git clone https://github.com/JeremyDev87/phlegon.git ~/.codex/skills/phlegon
```

`CODEX_HOME`을 별도로 설정했다면 해당 디렉터리의 `skills/phlegon`에 설치하십시오.

설치 후 Codex에서 명시적으로 호출합니다.

```text
$phlegon 검색 화면을 구현하고 입력 중 끊김이 생길 수 있는 경로를 확인해줘.
```

스킬 자체에는 별도 런타임이나 라이브러리 의존성이 없습니다. 실제 성능 검증에는 작업 환경의 브라우저와 측정 도구를 사용합니다.

### 2. Claude Code 플러그인

이하 `/path/to/phlegon`은 이 저장소를 받은 경로입니다. 위 스킬 설치 경로를 그대로 사용해도 됩니다. 플러그인을 지원하는 Claude Code에서 작업할 프로젝트로 이동한 뒤 실행합니다.

```bash
cd /path/to/project
claude --plugin-dir /path/to/phlegon
```

대화에서 에이전트 이름을 지정합니다.

```text
Agent 도구로 phlegon:phlegon 에이전트에 위임해줘. index.html의 반복 렌더링을 진단하고 결과를 기다려줘. 파일은 수정하지 마.
```

플러그인에 포함된 스킬만 현재 대화에서 실행하려면 `/phlegon:phlegon index.html의 반복 렌더링을 진단해줘`를 사용합니다. 스킬 호출과 에이전트 위임은 별개의 동작입니다.

비대화형 호출에서는 옵션 뒤에 `--`를 두어 요청과 경로를 구분합니다.

```bash
claude --plugin-dir /path/to/phlegon -p --permission-mode plan -- \
  'Agent 도구로 phlegon:phlegon에 index.html 진단을 위임하고 결과를 기다려줘. 수정하지 마.'
```

### 3. Codex 프로젝트 에이전트

프로젝트별 에이전트를 지원하는 Codex가 필요합니다. 프로젝트 루트에서 아래 명령으로 자체 지침이 포함된 TOML 한 파일을 복사합니다. 기존 파일이 있으면 덮어쓰지 않고 실패하므로, 내용을 확인한 뒤 직접 업데이트하십시오.

```bash
cd /path/to/project
test -f /path/to/phlegon/.codex/agents/phlegon.toml && \
  mkdir -p .codex/agents && \
  (set -C; cat /path/to/phlegon/.codex/agents/phlegon.toml > .codex/agents/phlegon.toml)
```

프로젝트에서 새 Codex 세션을 열고 역할을 지정합니다.

```text
phlegon 에이전트에 index.html의 반복 렌더링 진단을 위임해줘. 파일은 수정하지 말고, 결과를 기다린 뒤 근거를 알려줘.
```

네이티브 에이전트는 부모 세션의 권한과 도구를 상속합니다. 읽기 전용 진단은 부모 세션도 읽기 전용으로 시작하십시오. 역할 파일 자체가 별도 샌드박스를 만들지는 않습니다. [Codex 에이전트 문서](https://developers.openai.com/codex/subagents)

역할을 찾지 못하면 새 일반 세션에서 파일을 직접 지정할 수 있습니다. Codex 0.159.0의 `--ignore-user-config`를 사용한 격리 검증에서는 프로젝트 역할 자동 발견이 실패했고, 명시적 등록으로 실제 자식 에이전트의 파일 읽기와 결과 반환을 확인했습니다. 자동 발견 실패의 원인은 확정하지 않았습니다. 아래 `/absolute/project`를 신뢰하는 프로젝트의 실제 절대 경로로 바꾸십시오. 설정은 이 호출에만 적용되며 전역 설정 파일을 수정하지 않습니다.

```bash
codex -a never exec --ignore-user-config --disable hooks --disable plugins \
  --sandbox read-only --skip-git-repo-check --json --enable multi_agent \
  -C /absolute/project \
  -c 'projects."/absolute/project".trust_level="trusted"' \
  -c 'agents.phlegon.description="Phlegon native browser performance diagnosis"' \
  -c 'agents.phlegon.config_file="/absolute/project/.codex/agents/phlegon.toml"' \
  -c 'history.persistence="none"' -- \
  'spawn_agent 도구의 agent_type phlegon으로 index.html 진단을 위임해줘. 도구로 파일을 읽고 수정 없이 결과를 반환하게 한 뒤 기다려줘.'
```

이 버전의 검증에서는 `--ephemeral`을 넣으면 자식 생성 시 `no rollout found`가 발생했습니다. 네이티브 위임에는 위와 같이 `--ephemeral`을 제외하십시오. `history.persistence="none"`이어도 호스트의 세션 실행 기록은 남습니다. 이 명령은 훅·플러그인을 끄므로 해당 도구가 필요한 측정은 별도로 확인해야 합니다.

### 4. 터미널 CLI

Node.js 24 이상, npm, 사용할 `codex` 또는 `claude` 실행기가 필요합니다. macOS와 Linux를 대상으로 하며 Windows 프로세스 제어는 지원하지 않습니다. 선택한 실행기는 `PATH`에서 찾고, 그 실행기의 기존 로그인과 이용 한도를 사용합니다. Phlegon이 자격 증명을 읽거나 옮기거나 로그인을 대신하지 않습니다.

로컬 저장소 또는 준비된 tarball에서 설치합니다.

```bash
npm install --global /path/to/phlegon
# 또는
npm install --global /path/to/phlegon-version.tgz
```

전역 설치 없이 저장소에서 `node /path/to/phlegon/bin/phlegon.mjs --help`로 도움말을 볼 수도 있습니다.

```bash
phlegon --engine codex --cwd /path/to/project -- 'index.html의 반복 렌더링을 진단해줘.'
phlegon --engine claude --cwd /path/to/project -- 'index.html의 반복 렌더링을 진단해줘.'
printf '%s\n' 'index.html의 반복 렌더링을 진단해줘.' | phlegon --engine codex
phlegon --engine codex --cwd /path/to/project --fix --timeout 600 -- \
  'index.html의 중복 이벤트 등록만 수정하고 기능과 접근성을 확인해줘.'
```

`--cwd` 기본값은 현재 디렉터리, 제한 시간은 300초이며 `--timeout`은 1–3600초를 받습니다. 요청은 `--` 뒤의 인자 하나 또는 표준 입력으로 전달하며 최대 64 KiB입니다. 기본 동작은 진단이며, `--fix`도 요청한 범위와 호스트 권한 안에서만 수정을 허용합니다. 신뢰하는 프로젝트와 `PATH`의 실행기만 사용하십시오.

CLI는 공통 지침을 실행기에 전달하는 래퍼입니다. 네이티브 에이전트를 등록하거나 위임하지 않습니다. Codex 진단은 `read-only`, 수정은 `workspace-write` 샌드박스를 사용합니다. Claude 진단은 `plan` 권한과 `Read,Glob,Grep`만 사용하므로 셸·브라우저 측정은 할 수 없습니다. Claude 수정도 제한된 내장 파일 도구와 `acceptEdits` 범위에서 동작합니다.

CLI는 Codex 사용자 설정 로드를 끄고 Claude는 `--safe-mode`로 실행합니다. 따라서 평소 대화에서 쓰던 사용자 MCP·플러그인·훅·브라우저 도구를 그대로 사용할 수 있다고 가정하지 마십시오. 관리 정책은 계속 적용됩니다. 필요한 도구나 기준 측정이 없으면 그 한계를 보고하며, 권한을 자동으로 넓히지 않습니다.

## 결과 읽기

CLI는 검증된 응답을 다음 필드의 JSON 객체 하나로 출력합니다. 아래는 실제 측정값이 아닌 형식 예시입니다.

```json
{
  "status": "completed",
  "measurement": "unmeasured",
  "summary": "코드 진단을 마쳤지만 실행 시간은 측정하지 않았습니다.",
  "evidence": "index.html의 이벤트 등록 경로를 읽었습니다. 브라우저 도구가 없습니다.",
  "nextCheck": "같은 입력 조건으로 브라우저에서 수정 전후를 측정하십시오."
}
```

- `status`: `completed`는 유효한 보고를 받았다는 뜻이며, 성능 개선의 증거는 아닙니다. `blocked`는 작업을 완료할 수 없다는 뜻입니다.
- `measurement`: `not_applicable`(측정 불필요), `unmeasured`(미측정), `observed`(관찰했으나 비교 없음), `improved` / `unchanged` / `regressed`(비교 결과) 중 하나입니다.
- `summary`, `evidence`, `nextCheck`는 문자열입니다. 근거에는 조건과 실제 관찰을, 다음 확인에는 남은 검증을 기록합니다. 네이티브·스킬도 같은 보고 의미를 따르며 CLI가 JSON 형식을 검증합니다.

잘못된 입력, `blocked`, 실행기 실패, 시간 초과, 잘못되거나 너무 큰 출력은 0이 아닌 종료 코드를 반환합니다. 실행 오류는 원본 로그 대신 짧은 메시지로 stderr에 출력합니다. `blocked`는 검증된 전후 비교를 주장할 수 없습니다. 기준 측정이나 도구가 없거나 기능·접근성·이벤트 동작이 깨졌다면 성능 개선으로 보고하지 않습니다.

## 배경

[비싼 메인 스레드](https://kciter.so/posts/the-expensive-main-thread/)를 바탕으로 시작했습니다. Phlegon은 그리스·로마 신화에서 태양신의 마차를 끄는 말의 이름입니다.
