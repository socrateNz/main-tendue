# Modèle de données et règles financières

Référence de conception de l'application de gestion de parrainage scolaire.
Toute évolution d'une règle financière doit d'abord être reportée ici.

- Devise comptable unique : **XAF** (FCFA d'Afrique centrale), stocké en **entiers** (pas de sous-unité).
- Aucun mouvement financier validé n'est supprimé physiquement : il est **annulé** avec un motif.
- Les totaux (reçu, restant, solde de caisse…) sont **calculés** par agrégation, jamais stockés en double —
  sauf les **instantanés de clôture**, immuables (§ 8).

---

## 0. Les trois notions financières

Le système distingue strictement :

| Notion | Ce que c'est | Où c'est enregistré | Effet sur la caisse |
|---|---|---|---|
| **1. Mouvement de trésorerie** | Argent réellement entré ou sorti de la caisse | `cash_openings` (ouverture), `payments` (entrées), `expenses` (sorties) | Oui — **une seule fois**, à la date réelle |
| **2. Affectation financière** | Rattachement d'un montant **déjà encaissé** à un engagement (éventuellement d'une année antérieure) | lignes `COMMITMENT` des `payments`, `credit_applications` | **Aucun** |
| **3. Situation d'un engagement** | Attendu, affecté (reçu), reste à recevoir | calculée à partir des affectations | Aucun (lecture seule) |

**Garantie anti-double comptage** : la caisse ne se calcule **que** sur les mouvements de trésorerie
(§ 8). Les `credit_applications` n'y figurent jamais ; un versement n'est qu'un seul document dont le
montant `amountXaf` n'est compté qu'une fois, quelle que soit sa ventilation.

---

## 1. Vue d'ensemble des collections

| Collection | Rôle | Notion |
|---|---|---|
| `users` · `sessions` · `login_attempts` | Comptes, sessions révocables, limitation des tentatives | — |
| `audit_logs` | Journal d'audit (ajout uniquement) | — |
| `school_years` | Années scolaires, instantanés de clôture | — |
| `cash_openings` | **Solde initial** de la caisse (document unique) | Trésorerie |
| `schools` · `children` · `enrollments` | Établissements, enfants, scolarité annuelle | — |
| `sponsors` · `sponsorships` | Sponsors, parrainages sponsor × enfant × année | — |
| `commitments` | Engagement financier d'**un** parrainage | Situation (calculée) |
| `payments` | Versement réellement encaissé, ventilé | Trésorerie + affectations |
| `credit_applications` | Affectation d'une **avance** à un engagement | Affectation |
| `expense_categories` · `expenses` | Catégories, dépenses de la caisse centrale | Trésorerie |
| `videos` · `video_access_links` | Vidéos de remerciement, liens privés | — |

Les enfants et sponsors **ne sont pas dupliqués** par année : `enrollments` et `sponsorships` portent
le contexte annuel.

---

## 2. Années scolaires (`school_years`)

| Champ | Type | Règle |
|---|---|---|
| `label` | string | unique, format `AAAA-AAAA` |
| `startDate`, `endDate` | Date | `startDate < endDate`, **périodes sans chevauchement** (vérifié côté serveur, en transaction) |
| `status` | `DRAFT` · `ACTIVE` · `CLOSED` | une seule année `ACTIVE` à la fois (index unique partiel) |
| `closing` | objet \| null | instantané **immuable** figé à la clôture (§ 8) |
| `reopenings[]` | historique | réouvertures exceptionnelles (SUPER_ADMIN, motif) — l'instantané remplacé y est conservé |

- `DRAFT` : année en préparation (parrainages et engagements possibles).
- `ACTIVE` : année courante.
- `REOPENED` : année clôturée puis rouverte exceptionnellement ; accepte de nouveau des mouvements.
- `CLOSED` : aucun **nouveau** mouvement de trésorerie daté dans sa période, aucune modification ni
  annulation de ses mouvements.
- `archived` : archivage logique d'une année `CLOSED` (masquée des listes, rien n'est supprimé).

Règles de cycle de vie (service `features/school-years/service.ts`) :

| Opération | Conditions |
|---|---|
| Créer / modifier une période | pas de chevauchement ; pas avant l'année du solde initial ; pas avant une année clôturée ; les mouvements déjà rattachés doivent rester dans la période |
| Activer | année `DRAFT` ; aucune autre année `ACTIVE` ; aucune année antérieure restée `DRAFT` |
| Clôturer | année `ACTIVE` ou `REOPENED` ; période **terminée** (à partir du lendemain de la date de fin) ; toutes les années antérieures clôturées ; solde initial enregistré pour la première année |
| Rouvrir (SUPER_ADMIN, motif ≥ 10 car.) | uniquement la **dernière** année clôturée ; l'instantané est archivé dans `reopenings[]` |
| Supprimer | uniquement une année `DRAFT` sans aucune donnée liée (créée par erreur) ; auditée |

### Année d'un mouvement — déterminée par la date, côté serveur

| Mouvement | Date de référence |
|---|---|
| Versement (contribution, don, avance) | `receivedAt` (date réelle d'encaissement) |
| Dépense | `spentAt` (date réelle de la dépense) |

- Le serveur recherche l'année dont la période contient la date. **Le client ne transmet jamais l'année** :
  elle est calculée et stockée (`schoolYear`) avec la date réelle.
- Date hors de toute année configurée → **refus**. Date dans une année `CLOSED` → **refus**.
- L'**affectation** à un engagement d'une année antérieure reste permise (arriérés, § 5).

---

## 3. Solde initial de la caisse (`cash_openings`)

Ouverture de caisse : ce n'est **ni** une contribution, **ni** un don, **ni** une avance.

| Champ | Type | Règle |
|---|---|---|
| `_id` | `"MAIN"` | **identifiant fixe** : il ne peut exister qu'un seul solde initial pour la caisse |
| `schoolYear` | ObjectId | la **première** année de l'application (aucune année antérieure) |
| `amount` | int XAF ≥ 0 | peut être égal à 0 |
| `date` | Date | date de l'ouverture de caisse, comprise dans la période de la première année |
| `reason` | string | motif / justification obligatoire |
| `createdBy`, `createdAt` | | SUPER_ADMIN uniquement |
| `corrections[]` | historique | `{ from, to, reason, by, at }` |

- Création : SUPER_ADMIN, une seule fois, en transaction avec son entrée d'audit.
- Aucune modification ni suppression directe (bloquées au niveau du modèle).
- **Correction exceptionnelle** : procédure dédiée SUPER_ADMIN, motif obligatoire, ancien et nouveau montant
  conservés dans `corrections[]`, auditée. Autorisée uniquement si la première année **n'est pas clôturée**
  (sinon : réouverture préalable, elle-même auditée) — un instantané de clôture n'est jamais modifié.

---

## 4. Parrainages (`sponsorships`) et engagements (`commitments`)

**Parrainage** : `sponsor`, `child`, `schoolYear` (**unique** ensemble), `startDate`, `endDate?`,
`status` (`ACTIVE` · `SUSPENDED` · `ENDED` · `CANCELLED`).

**Engagement** : lié à **un seul parrainage** (index unique sur `sponsorship`).

| Champ | Règle |
|---|---|
| `sponsor`, `child`, `schoolYear` | dénormalisés depuis le parrainage, toujours identiques |
| `committedAmount` | **montant engagé** (int XAF > 0) |
| `expectedAmount` | **montant attendu** ; = engagé par défaut, ajustable avec motif (`expectedAdjustments[]`), jamais sous le montant déjà affecté |
| `status` | `ACTIVE` · `CANCELLED` (annulation impossible s'il existe des affectations valides) |

**Situation d'un engagement** (calculée, jamais stockée) :

```
affecté(e)  = Σ lignes COMMITMENT valides visant e     (versements non annulés)
            + Σ credit_applications valides visant e   (avances affectées)
restant(e)  = max(0, attendu(e) − affecté(e))
état(e)     = NON_HONORÉ (affecté = 0) · PARTIEL · HONORÉ (affecté = attendu)
```

Invariant : **affecté(e) ≤ attendu(e)**, vérifié en transaction à chaque affectation.

---

## 5. Versements (`payments`) — trésorerie et affectations

Un versement = **un encaissement réel**. Ventilé en lignes embarquées (écriture atomique).

| Champ | Règle |
|---|---|
| `number` | unique (`VRS-2026-000123`) |
| `sponsor` | obligatoire (un donateur est enregistré comme sponsor) |
| `receivedAt` | date réelle d'encaissement |
| `schoolYear` | **année du mouvement**, calculée par le serveur depuis `receivedAt` (§ 2) |
| `method`, `reference?` | référence unique par moyen de paiement parmi les versements valides (anti-doublon) |
| `currency` | `{ code, originalAmountMinor, rate, convertedAt }` — devise d'origine, montant d'origine (centimes), taux saisi, date de conversion |
| `amountXaf` | **montant comptable** = arrondi(originalAmountMinor × rate / 100), entier exact |
| `lines[]` | Σ `amount` **= `amountXaf`** strictement |
| `status`, `cancellation?` | `VALID` · `CANCELLED` (motif, auteur, date) |

**Lignes** :

| `kind` | Champs | Nature |
|---|---|---|
| `COMMITMENT` | `commitment`, `commitmentYear`, `lateSettlement`, `amount` | affectation à un engagement |
| `DONATION` | `amount` | don libre (recette distincte des contributions) |
| `ADVANCE` | `amount` | avance : recette encaissée, conservée comme **crédit** du sponsor |

Règles (service métier, en transaction) :
1. Σ lignes = `amountXaf`, chaque ligne > 0 ; un même engagement une seule fois par versement.
2. `COMMITMENT` : engagement `ACTIVE` **du même sponsor** ; montant ≤ **restant** de l'engagement.
   Un excédent n'est **jamais** affecté automatiquement : il doit être placé explicitement en `DONATION`
   ou `ADVANCE`.
3. **Arriérés** : l'engagement peut appartenir à une année **antérieure, même clôturée**.
   `commitmentYear` = année de l'engagement ; `lateSettlement = true` si elle précède l'année du
   mouvement. Le versement entre dans la caisse de **son** année (`schoolYear`) ; l'instantané de clôture
   de l'année de l'engagement **n'est pas modifié**.
4. Un engagement d'une année **postérieure** à celle du mouvement : refusé en ligne `COMMITMENT`
   (l'argent reçu d'avance se place en `ADVANCE`, puis s'affecte par `credit_applications`).
5. Don sans engagement = versement avec une seule ligne `DONATION`.

Trois dates/années distinctes sont donc conservées : **date d'encaissement** (`receivedAt`),
**année du mouvement** (`schoolYear`), **année de l'engagement affecté** (`lines.commitmentYear`).

---

## 6. Avances — registre et affectations (`credit_applications`)

L'avance est encaissée (trésorerie) à sa réception ; son affectation ultérieure est une **affectation
pure**, sans effet sur la caisse.

| Champ | Règle |
|---|---|
| `sponsor`, `sourcePayment`, `sourceLine` | ligne `ADVANCE` d'origine (versement valide) |
| `sourceYear` | année du mouvement d'origine (encaissement) |
| `commitment`, `schoolYear` | engagement visé (`ACTIVE`, même sponsor) et **son** année |
| `lateSettlement` | vrai si l'engagement est d'une année antérieure à la date d'affectation |
| `amount` | ≤ crédit restant de la ligne source **et** ≤ restant de l'engagement |
| `validatedBy`, `validatedAt` | validation explicite (FINANCE_MANAGER / SUPER_ADMIN) |
| `status`, `cancellation?` | mêmes règles d'annulation que les versements |

**Registre des avances par sponsor** (vue calculée) :

```
encaissé(ligne)   = ligne ADVANCE d'un versement valide
affecté(ligne)    = Σ credit_applications valides issues de la ligne
disponible(ligne) = encaissé − affecté
registre(sponsor) = Σ encaissé, Σ affecté, Σ disponible + historique (versements d'origine et affectations)
```

- Un versement dont une avance a été (même partiellement) affectée ne peut être annulé qu'après
  annulation des affectations correspondantes.
- Annuler une affectation ne touche pas la caisse : le crédit redevient disponible.

---

## 7. Dépenses (`expenses`)

| Champ | Règle |
|---|---|
| `number` | unique (`DEP-2026-000045`) |
| `spentAt` / `schoolYear` | date réelle ; année calculée par le serveur (§ 2) |
| `category`, `amount` | catégorie active ; **seul montant comptabilisé** |
| `scope` | `GENERAL` (sans enfant) · `INDIVIDUAL` (1 enfant) · `COLLECTIVE` (≥ 2 enfants) |
| `allocationMode` | `EQUAL` (reste au premier enfant) · `MANUAL` |
| `allocations[]` | `{ child, amount }`, enfants distincts, Σ = `amount` **strictement** |
| `status`, `cancellation?` | mêmes règles que les versements |

Une dépense collective est enregistrée **une seule fois** ; ses allocations ne servent qu'aux vues par
enfant / établissement et ne sont jamais additionnées aux totaux financiers.

---

## 8. Caisse centrale — solde cumulé et clôtures

Pour une année Y (ordonnées par `startDate`), **uniquement des mouvements de trésorerie valides** :

```
ouverture(Y)     = cash_openings.amount                 si Y est l'année du solde initial
                 = clôture(année précédente)            sinon (instantané si clôturée, calcul sinon)
contributions(Y) = Σ lignes COMMITMENT   des versements valides dont schoolYear = Y   (arriérés inclus)
dons(Y)          = Σ lignes DONATION     des versements valides dont schoolYear = Y
avances(Y)       = Σ lignes ADVANCE      des versements valides dont schoolYear = Y
dépenses(Y)      = Σ expenses.amount     valides dont schoolYear = Y   (jamais les allocations)

clôture(Y)       = ouverture(Y) + contributions(Y) + dons(Y) + avances(Y) − dépenses(Y)
```

`credit_applications` n'entre **jamais** dans ce calcul.

**Clôture d'une année** (ADMIN / SUPER_ADMIN, séquentielle) — instantané immuable :

| Champ | |
|---|---|
| `openingBalance`, `contributions`, `lateContributions`, `donations`, `advances`, `expenses`, `closingBalance` | trésorerie de l'année |
| `commitmentsExpected`, `commitmentsAllocatedAtClosing` | situation des engagements de l'année à la date de clôture |
| `advancesAvailableAtClosing` | crédit d'avances non affecté à la date de clôture |
| `closedAt`, `closedBy` | |

- Les règlements tardifs ultérieurs modifient la **situation** des engagements de l'année (vue « à date »),
  jamais son instantané. Les rapports peuvent présenter les deux : « à la clôture » et « à date ».
- **Réouverture** (SUPER_ADMIN, motif, auditée) : l'instantané en vigueur est archivé dans `reopenings[]`
  (jamais effacé) ; une nouvelle clôture produit un nouvel instantané.

---

## 9. Annulation des mouvements financiers

S'applique à `payments`, `credit_applications`, `expenses`.

- Réservée à **FINANCE_MANAGER** et **SUPER_ADMIN** ; motif obligatoire ; auteur et horodatage enregistrés.
- Le mouvement reste consultable avec le statut « Annulé » ; il ne peut être ni réactivé ni modifié.
- Les rapports excluent les mouvements annulés.
- Interdite si l'année du **mouvement** est `CLOSED` (sauf réouverture préalable). Une affectation tardive
  rattachée à un engagement d'une année clôturée reste annulable tant que l'année du mouvement est ouverte.
- Champs financiers d'un mouvement `VALID` non modifiables (montant, lignes, devise, date, sponsor) :
  annuler puis ressaisir. Seuls `note` et justificatifs restent modifiables (audité).
- Chaque création / annulation est écrite dans `audit_logs` **dans la même transaction**.

---

## 10. Vidéos de remerciement

`videos` : `child`, `schoolYear`, `title`, `asset` (Cloudinary `authenticated`), `availableAt`,
`expiresAt` (= `availableAt + 90 j` par défaut, modifiable), `status`, `deletion { attempts,
lastAttemptAt, lastError, deletedAt }`.

| `status` | Signification |
|---|---|
| `PROCESSING` | téléversement reçu, pas encore mis à disposition |
| `AVAILABLE` | liens actifs |
| `REVOKED` | accès révoqués manuellement (fichier conservé jusqu'à l'échéance) |
| `PENDING_DELETION` | échéance atteinte : liens invalidés, suppression Cloudinary à faire / à retenter |
| `DELETED` | fichier supprimé ; métadonnées et historique conservés |

`video_access_links` : `video`, `sponsor`, `tokenHash` (SHA-256, unique), `active`, `expiresAt`,
`revokedAt?`, `lastAccessAt?`, `accessCount`, `downloadCount`. Un seul lien actif par sponsor et vidéo.

- Jeton : 32 octets aléatoires (base64url), affiché **une seule fois**.
- Accès : vérification serveur (jeton, statut, expiration), journalisation, puis URL Cloudinary **signée
  expirant en quelques minutes**.
- Tâche planifiée (`/api/cron/expire-videos`, `CRON_SECRET`) : échéance → `PENDING_DELETION` ; suppression
  Cloudinary ; `DELETED` **uniquement après confirmation** ; en cas d'échec, `attempts++` et nouvelle
  tentative au passage suivant.

---

## 11. Rôles et permissions (résumé)

| Action | SUPER_ADMIN | ADMIN | FINANCE_MANAGER | CHILD_MANAGER | MEDIA_MANAGER |
|---|:-:|:-:|:-:|:-:|:-:|
| Utilisateurs | ✔ | | | | |
| Solde initial de caisse (création, correction) | ✔ | | | | |
| Années : créer / activer / clôturer | ✔ | ✔ | | | |
| Année : réouverture | ✔ | | | | |
| Enfants, établissements, scolarité | ✔ | ✔ | lecture | ✔ | lecture |
| Sponsors, parrainages | ✔ | ✔ | ✔ | lecture | lecture |
| Engagements | ✔ | ✔ | ✔ | lecture | |
| Versements, dons, avances, affectations d'avances | ✔ | ✔ | ✔ | | |
| Mouvements financiers : annuler | ✔ | | ✔ | | |
| Dépenses : saisir | ✔ | ✔ | ✔ | | |
| Catégories de dépenses | ✔ | ✔ | ✔ | | |
| Vidéos : importer, liens, révoquer | ✔ | ✔ | | | ✔ |
| Rapports financiers | ✔ | ✔ | ✔ | | |
| Journal d'audit | ✔ | ✔ | | | |

La matrice fait foi dans `lib/auth/permissions.ts` ; chaque service vérifie la permission côté serveur.

---

## 12. Écritures concurrentes

Chaque affectation (ligne de versement, affectation d'avance) et chaque modification d'engagement
incrémente, **dans la même transaction**, un compteur de version : `commitments.allocationVersion`
(plafond « affecté ≤ attendu ») et `payments.creditVersion` (plafond du crédit d'avance). Deux écritures
simultanées sur le même engagement ou la même avance entrent en conflit d'écriture : MongoDB en rejette
une, qui est rejouée avec les montants à jour, puis refusée si le plafond est atteint. Ce comportement
est couvert par un test d'intégration (deux versements simultanés : un seul passe).
