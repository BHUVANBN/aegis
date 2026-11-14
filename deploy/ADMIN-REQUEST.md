# Request: Entra app registrations for AEGIS
Use this only if your account cannot create app registrations (preflight reported CAN_APPREG=0).
Give this page to a tenant admin. They return the three IDs at the bottom.

## 1. App registration `aegis-api` (single tenant)
- **App roles** (Allowed member types in brackets; all enabled):
  `viewer` [Users], `assessor` [Users], `approver` [Users], `admin` [Users], `pipeline` [Applications]
- **Application ID URI:** `api://<its own application (client) id>`
- **Manifest:** `requestedAccessTokenVersion = 2`
- **Expose an API:** scope `access_as_user` (who can consent: Admins and users), state Enabled
- **Authorized client applications:** the `aegis-web` client id (below) and `04b07795-8ddb-461a-bbee-02f9e1bf7b46` (Azure CLI), both with the `access_as_user` scope
- **Enterprise application:** make sure the service principal exists
- **Users and groups:** assign the requester the roles `admin`, `assessor`, `approver`, `viewer`

## 2. App registration `aegis-web` (single tenant)
- **Platform:** Single-page application
- **Redirect URIs:** `http://localhost:5173` and `https://<dashboard host>` (the host appears after step 70; it can be added later)

## 3. Send back
`Tenant ID`, `aegis-api Application (client) ID`, `aegis-web Application (client) ID`.
Then in `deploy/config.env`:
```
ENTRA_PROVIDED=1
API_APPID="<aegis-api client id>"
WEB_APPID="<aegis-web client id>"
```
and run `./run-all.sh --from 20-entra`.
