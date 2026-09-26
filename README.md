# Petit Arona Feed

GitHub Actions가 10분마다 `sources.json`의 소스를 한 번씩 읽어 `feed.json` 하나로 합친 뒤 GitHub Pages에 배포한다. 앱은 [feed.json](https://neruu00.github.io/Feed/feed.json)만 읽는다.

## 중계하는 이유

앱 사용자마다 넥슨 커뮤니티에 직접 요청하면 사용자 수만큼 트래픽이 생긴다. 예를 들어 사용자 1,000명이 10분마다 요청하면 초당 약 1.7회가 된다. 넥슨 API 응답에는 캐시가 없다(`no-store`). 중계하면 원본 사이트에는 사용자 수와 상관없이 10분에 한 번만 요청한다.

넥슨 API는 공개 API가 아니라 게시판 웹페이지가 쓰는 내부 주소라 바뀔 수 있다. 주소나 응답 형식이 바뀌면 이 저장소의 스크립트만 고치면 된다.

## 소스

`sources.json`은 넥슨 게시판(`nexon-forum`, `alias`, `board`)과 유튜브 채널(`youtube`, `channelId`)을 지원한다. 현재 소스는 블루 아카이브 공지사항(`forum.nexon.com`, `bluearchive`, 게시판 `1018`)과 블루 아카이브 유튜브(`UCj0iColXMAjPA92rH-AXVGQ`)다.

소스를 추가할 때 `sources.json` 배열에 다음 항목을 넣는다.

```json
{
  "id": "example-youtube",
  "type": "youtube",
  "name": "예시 채널",
  "channelId": "UCj0iColXMAjPA92rH-AXVGQ"
}
```

## 피드 형식

```json
{
  "version": 1,
  "generatedAt": "생성 시각",
  "sources": [
    { "id": "소스 ID", "name": "소스 이름", "ok": true, "checkedAt": "확인 시각", "error": "실패 이유(실패한 경우)" }
  ],
  "items": [
    {
      "id": "<sourceId>:<원본 id>",
      "source": "소스 ID",
      "title": "제목",
      "url": "원본 주소",
      "publishedAt": "ISO 8601 게시 시각",
      "thumbnail": null
    }
  ]
}
```

항목은 `publishedAt` 내림차순으로 정렬하며 소스마다 최대 20개를 담는다. 넥슨 게시판은 고정 공지(`isSticky`)도 목록에 섞이므로 앱은 `publishedAt`으로 새 글을 판단해야 한다.

소스 요청이 실패하면 직전에 배포한 피드에서 해당 소스의 항목을 그대로 유지하고, 소스 정보에 `ok: false`와 `error`를 기록한다.

## 배포

예약 실행은 항목과 소스의 `id`·`name`·`ok`가 바뀐 경우에만 배포한다. `push`와 수동 실행(`workflow_dispatch`)은 항상 배포한다. GitHub Pages 기본 캐시는 10분이다. 예약 실행은 정시에 보장되지 않아 몇 분 늦을 수 있다.

처음 설정할 때 저장소 **Settings → Pages → Build and deployment → Source**를 **GitHub Actions**로 바꾼다. 그다음 **Actions** 탭에서 feed 워크플로를 수동으로 한 번 실행한다.

## 로컬 실행

Node.js 22 이상이 필요하다. 내장 `fetch`를 쓰며 외부 패키지는 없다. `public/`은 `.gitignore`에 들어 있다.

```sh
node scripts/build-feed.mjs --out public/feed.json --previous https://neruu00.github.io/Feed/feed.json
```

## 예약 작업 유지

공개 저장소는 60일 동안 활동이 없으면 예약 작업이 꺼진다. keepalive 워크플로가 매달 1일 빈 커밋을 남긴다.
