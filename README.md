# Main Tendue — gestion du parrainage scolaire

Application interne (Next.js 16, TypeScript strict, MongoDB Atlas, Cloudinary) pour gérer les enfants
bénéficiaires, les sponsors, les parrainages, les engagements financiers, les versements, les dépenses
de la caisse centrale, les vidéos de remerciement et les rapports.

Les règles financières validées sont décrites dans [`docs/modele-donnees.md`](docs/modele-donnees.md) :
c'est la référence à mettre à jour avant toute évolution d'une règle.

## Démarrage local

```bash
npm install
cp .env.example .env.local      # puis renseigner les valeurs
npm run check:services          # vérifie variables, MongoDB et Cloudinary (sans afficher de secret)
npm run db:indexes              # crée collections et index (non destructif)
npm run create-admin -- --email vous@exemple.org --first-name Prénom --last-name Nom
npm run dev
```

La commande `create-admin` ne fonctionne qu'une fois : elle est refusée dès qu'un super administrateur
existe. Les autres comptes se créent depuis **Utilisateurs** (mot de passe temporaire à changer à la
première connexion).

## Variables d'environnement

| Variable | Rôle |
|---|---|
| `MONGODB_URI` | URI `mongodb+srv://…` d'Atlas (utilisateur avec droits lecture/écriture) |
| `MONGODB_DB` | Nom de la base (défaut `parrainage`) |
| `CLOUDINARY_URL` | `cloudinary://API_KEY:API_SECRET@CLOUD_NAME` |
| `JWT_SECRET` | ≥ 32 caractères — signe le cookie de session |
| `CRON_SECRET` | ≥ 32 caractères — protège la tâche planifiée des vidéos |
| `NEXT_PUBLIC_APP_URL` | URL publique (sert à construire les liens vidéo des sponsors) |

Générer un secret : `node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"`.
Utiliser des secrets **différents** en local et en production.

## Scripts

| Commande | Effet |
|---|---|
| `npm run dev` / `build` / `start` | Développement, build, serveur de production |
| `npm run lint` / `typecheck` | ESLint, TypeScript |
| `npm test` | Tests unitaires (règles financières, sécurité, dates, CSV, conversions d'import) |
| `npm run test:integration` | Tests sur MongoDB : chaque exécution crée **et supprime** sa propre base `parrainage_test_<horodatage>` ; la base applicative n'est jamais touchée |
| `npm run check:services` | Diagnostic des services externes |
| `npm run db:indexes` | Synchronise les index (à lancer après une évolution des modèles et avant la mise en production) |

## Déploiement sur Vercel

1. **MongoDB Atlas** — *Network Access* : autoriser `0.0.0.0/0` (les adresses IP de Vercel sont
   dynamiques ; la sécurité repose sur l'utilisateur et le mot de passe Atlas). Un cluster M10+ est
   recommandé en production (sauvegardes continues).
2. **Cloudinary** — *Settings > Security* : activer « Strict transformations ». Vérifier la limite de
   taille vidéo de l'offre (100 Mo sur l'offre gratuite ; `VIDEO_MAX_BYTES` dans `features/videos/types.ts`).
3. **Vercel** — importer le dépôt, renseigner les six variables (environnement *Production*), avec
   `NEXT_PUBLIC_APP_URL` = l'URL définitive (domaine personnalisé si possible).
4. Choisir une région de fonctions proche du cluster Atlas (*Settings > Functions*).
5. Après le premier déploiement : `npm run db:indexes` avec les variables de production, puis
   `npm run create-admin` (en local, pointé sur la base de production).
6. La tâche planifiée `/api/cron/expire-videos` est déclarée dans `vercel.json` (tous les jours à 3 h UTC).
   Vercel l'appelle avec `Authorization: Bearer <CRON_SECRET>`.

## Architecture

```text
app/                      routes (App Router) : (auth), (dashboard), v/[token] (sponsors), api/
features/<domaine>/       model.ts · schemas.ts (Zod) · service.ts (règles, transactions, audit)
                          queries.ts (lectures) · actions.ts (Server Actions) · components/
lib/                      auth/ (sessions, permissions) · db/ · cloudinary/ · security/ · money.ts · dates.ts
components/               ui/ (shadcn sur Base UI) · shared/ · layout/
proxy.ts                  contrôle rapide du cookie de session (la vérification réelle est côté serveur)
docs/modele-donnees.md    modèle de données, règles financières validées, import Excel (§ 13)
```

Principes : chaque page et chaque action vérifient la permission côté serveur ; toute mutation
financière s'exécute dans une transaction MongoDB avec son entrée d'audit ; les montants sont des
entiers en FCFA (XAF) ; aucun mouvement financier n'est supprimé (annulation motivée) ; les fichiers
(photos, justificatifs, vidéos) sont privés sur Cloudinary et servis par URL signée.
