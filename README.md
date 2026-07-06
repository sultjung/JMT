# 우리팀 점심·회식 추천 대시보드

대신파이낸스센터 기준 반경 400m 이내 식당을 추천하는 GitHub Pages용 정적 웹앱입니다.

## 파일 구조

```text
index.html
style.css
app.js
restaurants.js
naver-query-config.json
scripts/fetch_naver_restaurants.py
.github/workflows/sync-naver-restaurants.yml
```

## 네이버 지역검색 API 연동 방식

브라우저에서 네이버 Local Search API를 직접 호출하지 않습니다. `Client Secret`이 노출되기 때문입니다.

대신 GitHub Actions가 `NAVER_CLIENT_ID`, `NAVER_CLIENT_SECRET`을 GitHub Secrets에서 읽어 네이버 지역검색 API를 호출하고, 결과를 `restaurants.js`로 생성합니다. 웹페이지는 생성된 `restaurants.js`만 읽습니다.

## GitHub Secrets 설정

GitHub 저장소에서 다음 값을 등록하세요.

- `NAVER_CLIENT_ID`
- `NAVER_CLIENT_SECRET`

경로: `Settings` → `Secrets and variables` → `Actions` → `New repository secret`

## 실행 방법

1. 네이버 개발자 센터에서 애플리케이션 등록
2. 사용 API에 `검색` 추가
3. Client ID / Client Secret 발급
4. GitHub Secrets에 위 두 값 등록
5. Actions 탭에서 `Sync Naver Restaurants` 수동 실행
6. `restaurants.js`가 자동 갱신되면 GitHub Pages에서 확인

## 검색어 수정

`naver-query-config.json`의 `queries` 배열을 수정하면 됩니다.

## 수동 보정

네이버 API는 가격, 추천 메뉴, 단체 가능 여부를 직접 주지 않습니다. 그래서 이 앱은 카테고리 기반으로 가격·메뉴를 추정합니다.

특정 식당을 보정하려면 `naver-query-config.json`의 `manualOverrides`에 식당명을 넣고 원하는 필드를 덮어쓰면 됩니다.
