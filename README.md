# Pulse Habit

Mobiele habit tracker PWA in plain HTML, JavaScript en Tailwind CDN.

## Pagina's

- `index.html` - Main dashboard
- `activity.html` - Maand resultaten met een GitHub-achtig maandgrid
- `profile.html` - Redirect naar maand resultaten voor oude links of bookmarks

## Wat zit erin

- Mobile-first iPhone-stijl layout
- PWA manifest + service worker
- Lokale opslag voor habits en profiel
- Realtime basis via `BroadcastChannel` en optionele WebSocket sync
- Push notification flow via service worker + optionele VAPID subscription

## Lokaal draaien

Gebruik een lokale webserver. Open dit dus niet als `file://`, want service workers en web push werken dan niet.

Voorbeelden:

```powershell
cd c:\Users\WALT03\Desktop\Habittracker
python -m http.server 8080
```

Open daarna `http://localhost:8080`.

## Multiplayer activeren

Vul in [`app-config.js`](./app-config.js):

```js
window.HabitTrackerConfig = {
  sync: {
    enabled: true,
    mode: "websocket",
    websocketUrl: "wss://jouw-server.example/ws",
    room: "team-sprint",
    authToken: "optional-token"
  }
};
```

De client verstuurt berichten zoals:

```json
{
  "type": "join",
  "room": "team-sprint",
  "token": "optional-token",
  "state": {}
}
```

en daarna `state:update` payloads voor live sync.

## Push notifications activeren

Vul in [`app-config.js`](./app-config.js):

```js
window.HabitTrackerConfig = {
  push: {
    vapidPublicKey: "JOUW_PUBLIC_VAPID_KEY",
    subscriptionEndpoint: "https://jouw-api.example/api/push/subscribe"
  }
};
```

De app post dan subscriptions naar je backend als JSON:

```json
{
  "subscription": {},
  "teamCode": "PULSE-4821",
  "profile": {}
}
```

Daarna kan je backend web push sturen naar de opgeslagen subscription. Op iPhone werkt web push in de praktijk via een geïnstalleerde PWA op iOS 16.4+.
