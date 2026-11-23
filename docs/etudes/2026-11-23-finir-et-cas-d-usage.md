# Complément du 23/11 : finir et livrer, montrer un cas d'usage

Constat du mainteneur : les agents avancent très bien au début, mais ont un mal fou à finir et à livrer. Et sur l'EPIC POI : « il passe trop de temps à faire on ne sait quoi, alors qu'il faut juste intégrer ce qui a été développé dans les démos techniques » ; « il manque des cas d'usage. L'agent comprend beaucoup mieux quand on lui montre de quoi on a besoin, pas quand on lui dit. »

Étude en lecture seule : ledgers et états des fils Spawn du 22/11, transcripts des trois EPIC en console (`Godot4/497eedd3`, `Godot4/72879f46`, `rpg-demo/62c2eeb1`). Scripts `passes.cjs`, `briefs.cjs`, `users.cjs` (scratchpad de la session du mainteneur, non conservés).

**Verdict : les agents ne ralentissent pas à la fin. La fin demande trois choses que le début ne demande pas : un résultat juste à l'œil, une branche intégrée à un `develop` qui a bougé, et des décisions. Sans cas d'usage montré, l'agent invente ses données et sa mesure du « bon », tout passe au vert, et l'écart n'apparaît qu'au regard du mainteneur.**

## Mesure

**Spawn, 22/11 : trois fils, tâches rapides, aucune fusion.** Tâches de 5 à 10 min, plan complet en 3 à 4 h. Puis chaque fil s'arrête à la fin, et rien ne le relance :

| Fil | Arrêt | Depuis |
|---|---|---|
| `affiche-une-poi-cuite-v2` | relecture finale : gel de 1,3 s au lancement ; l'unique correction le déplace (2,3 s à froid) ; `blocked:decision` | 22/11 23:02 |
| `permets-de-cuire-une-carte` | accepté par le mainteneur à 23:04, puis conflits avec `develop` (la console y avait fusionné entre-temps) | 22/11 23:04 |
| `cree-le-catalogue-map-editor` | question A/B/C posée à 19:02 ; réponse au ledger à 23:04 ; fil jamais repris | 22/11 19:21 |

**Console, 23/11 : livre, mais la fin traîne.**

- Animations : l'échelle et le poteau prennent quatre passes, d'environ 1 h, 20 min, 40 min, puis une quatrième encore en cours à 18:21. Ensuite : « Deux heures, et les IK sont cassées », et à 18:21 encore « c'est pas bon pour l'IK des mains ».
- RPG : les stories de la nuit passent en 10 à 35 min chacune. Le jour, cinq passes de correction suivent les essais du mainteneur, par exemple « As-tu vraiment testé ? ». Puis « attention à ne pas sur-tester ».
- POI : de 07:37 à 18:48, une vingtaine de passes reconçoivent :
  - les formats v4 puis v5 ;
  - le domaine POI du scatter ;
  - les imposteurs unifiés ;
  - deux analyses de l'écart de rendu ;
  - des densités re-mesurées contre les démos.

  À 18:48, le mainteneur : « Il faut "juste" implémenter, copier/coller, les mécanismes dans l'addon terrain. » Le portage de l'herbe prend alors 35 min, et l'agent rapporte qu'elle rend comme la démo.
- Catalogue POI : le catalogue de test de l'agent proposait des dizaines de textures et d'essences, sur une carte dessinée par script (« complètement pété »). Le mainteneur montre sa carte `map01` à 19:22. À 19:23, l'agent répond juste du premier coup :
  - une palette de designer de quelques sols et végétations ;
  - un sol composé, qui porte toutes ses textures ;
  - au bake, la combinaison sol × végétation donne le scatter d'une démo.

Réfuté : « l'agent fatigue en fin de parcours ». Les passes longues (84, 80, 109 min) tombent n'importe où dans la nuit, pas surtout à la fin.

Non vérifié :
- la cause de chaque essai raté du mainteneur (on n'a que ses messages) ;
- que les conflits soient le seul blocage du fil map-editor ;
- la part de la journée POI qui était nécessaire. Le passage des POI par le scatter l'était sans doute, mais l'herbe, le sol, les débris et le CLOSE étaient déjà dans les démos.

## Trois causes

1. **Le dernier verdict vient de l'œil du mainteneur, et il arrive trop tard.** Le début construit de la structure, qu'un test prouve. La fin doit être juste à l'usage : des mains sur les barreaux, deux clients qui se rejoignent, un rendu naturel. Les tests sont verts et le résultat est faux, alors l'agent s'entête sur ses tests.
2. **L'intégration est repoussée à la fin.** Les branches prennent du retard sur `develop`, que d'autres fils font avancer. Le conflit n'apparaît qu'à la fusion.
3. **Les décisions arrivent à la fin, et le travail ne reprend pas.** Un budget de performance ou une règle de catalogue se fixent au cadrage ; ici, ils remontent à la relecture finale. Dans Spawn, la réponse du mainteneur ne relance pas le fil.

La cause 1 vient surtout de l'**absence de cas d'usage montré**. Sans exemple, l'agent fabrique ses propres données de test (sa carte, son catalogue) et sa propre mesure du « bon » (des densités recalculées). Il ignore aussi qu'une référence existe et qu'il faut la reproduire, pas l'égaler par ses propres moyens.

## Propositions (rien n'est décidé)

1. **Un cas d'usage montré à chaque cadrage.** Décidé dans son principe par le mainteneur le 23/11. Chaque EPIC, ou story, part d'un exemple concret que le mainteneur fournit ou désigne. Selon le besoin, c'est :
   - une image : capture d'une démo, croquis, scène d'un autre jeu ;
   - un modèle de données : une carte comme `map01`, une sauvegarde, une fiche de catalogue ;
   - un bout de code : l'usage attendu d'une API, un appel type ;
   - une scène de référence à égaler ;
   - un scénario de jeu : « héberger sur un client, rejoindre sur l'autre ».

   S'il manque, le cadrage le demande au mainteneur, au lieu de laisser l'agent en inventer. Le brief de chaque tâche cite le cas d'usage qu'elle sert.
2. **Une référence calibrée se porte, elle ne se ré-étudie pas.** Quand une référence existe, la tâche est un portage : mécanismes et valeurs copiés. La preuve est une capture côte à côte avec la référence. Une analyse n'est permise que si le portage échoue.
3. **Les preuves tournent sur les données du mainteneur.** Captures, recette et jugement se font sur son cas d'usage, jamais sur des données inventées par l'agent.
4. **Intégrer en continu.** À chaque fusion dans `develop`, chaque story ouverte sur ce dépôt reçoit une note de ce qui change et intègre `develop` tout de suite.
5. **Reprendre sur décision.** Un fil en `blocked:decision` repart dès que la décision du mainteneur est au ledger (`ruling --by user`).
6. **Finir avant de commencer.** Pas de nouveau lot tant que le précédent n'est pas fusionné. La file du point 3 de l'étude du jour peut l'appliquer.

Les propositions 1 à 3 entrent dans le cadrage par EPIC (point 2 de l'étude du jour). Elles remplaceraient bien le commit `74e6bf2` : sa section « Existant » ne dit pas ce qu'il faut reproduire ni sur quel exemple juger. Les propositions 4 et 5 sont petites, et se mesurent dans le service et le kit.

## Décisions attendues

1. La forme du cas d'usage dans le modèle : une section de la spec et du cadrage d'EPIC, ou des fichiers joints au fil.
2. L'ordre : cadrage par EPIC avec cas d'usage d'abord, ou intégration continue et reprise sur décision d'abord.
3. Le sort de `74e6bf2` : annulé, ou fondu dans le cadrage par EPIC.
