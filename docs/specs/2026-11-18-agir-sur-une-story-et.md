# Agir sur une story et suivre son avancement (spec, 2026-11-18)

Demande : « Agir sur une story et suivre son avancement, comme le dit le parcours validé `docs/parcours.md` section P11 ».

## Ce que tu verras

Sur la page d'une story, chaque bouton qui envoie quelque chose (valider la spec, répondre, valider la recette, demander des changements, abandonner, pause, reprendre, envoyer un message, nouvelle feature, renommer) passe en attente au clic (« Validation… », « Envoi… ») et grise les autres gestes de la carte. Un refus s'affiche à côté du bouton, en mots simples. Quand tu valides la recette, la carte disparaît pour un bandeau « Fusion en cours : intégration à develop, suite complète des tests — 2 min », qui finit par « Livrée dans develop (abc1234) » ou « Fusion refusée : <cause>. L'agent corrige, puis réinscrit ; rien à faire pour toi. »

La frise d'avancement n'a jamais qu'une étape en cours, celle que donne `spawn next` ; après un retour en arrière, l'étape dit pourquoi (« reprise après recette : <ta demande> », « fusion refusée : <cause> »). « L'agent travaille… » et le point vivant n'apparaissent que pendant un tour d'agent ; sinon la story dit « à toi : … », « en pause » ou « arrêtée : <dernière phrase de l'agent> », avec **Reprendre**.

Pendant un tour ou une fusion, tu peux écrire : ton message s'affiche « en attente » dans la conversation, tu peux le retirer tant qu'il n'est pas parti, et il part à la fin du tour (ou de la fusion).

## Exigences

- **SGS-33** Au clic sur un bouton qui envoie quelque chose, le bouton affiche son attente et les autres gestes de la carte sont grisés jusqu'à la réponse ; un refus s'affiche à côté du bouton et les gestes redeviennent actifs. Preuve : aucune ; tu le regardes à la recette. Un test demanderait un outillage de rendu des composants React que le projet n'a pas.
- **SGS-34** Un second « Valider » pendant une fusion n'est pas une erreur : le service répond que la fusion est déjà en cours, avec sa date de début. Preuve : test ; contrôle négatif : « Valider » sur une story qui n'est pas à juger reste refusé avec sa raison.
- **SGS-35** Le détail d'une story dit l'action longue en cours (fusion ou tour d'agent) avec sa date de début, et l'issue de la dernière fusion : livrée (commit), refusée (cause) ou en erreur. Preuve : test ; contrôle négatif : sans fusion ni tour en cours, aucune action longue n'est annoncée.
- **SGS-36** La page d'une story montre ce bandeau d'action longue avec la durée écoulée, sans bouton Valider tant qu'elle tourne, puis son issue dans le même bandeau. Preuve : aucune ; tu le regardes à la recette (la capture ne montre que l'écran d'accueil).
- **SGS-37** L'avancement a exactement une étape en cours, celle que donne `spawn next` ; celles d'avant sont faites, celles d'après à venir. Preuve : test ; contrôle négatif : le ledger de l'essai du 18/11 (fusion refusée, puis tâche ajoutée après la recette) ne donne ni deux étapes en cours, ni une étape faite après une étape pas faite.
- **SGS-38** Après un retour en arrière, l'étape où la story revient dit pourquoi (« reprise après recette : <demande> », « fusion refusée : <cause> »), et les tâches ajoutées suivent dans la liste du Développement. Preuve : test ; contrôle négatif : une story sans retour en arrière n'a pas ce motif.
- **SGS-39** Une étape rendue par l'outil que l'app ne connaît pas s'affiche « Étape non reconnue : <texte de l'outil> » à la place de l'étape en cours. Preuve : test ; contrôle négatif : une étape connue ne produit pas ce libellé.
- **SGS-40** Sans tour en cours, aucun libellé d'activité n'est donné ; la story dit « à toi : <ce qui est attendu> », « en pause » après Pause, ou « arrêtée : <dernière phrase de l'agent> » après un tour fini sans point d'arrêt prévu ; « Reprendre » relance un tour dans ces deux derniers cas, et « arrêtée » n'arrive pas dans ce qui attend l'utilisateur. Preuve : test (service, faux agent) ; contrôle négatif : Reprendre pendant un tour en cours est refusé.
- **SGS-41** Un message envoyé pendant un tour ou une fusion est accepté et mis en file au lieu d'être refusé ; il part à la fin du tour (un nouveau tour s'ouvre) ou de la fusion ; plusieurs messages en file partent ensemble, dans l'ordre ; une fusion refusée les emporte avec le rappel de l'agent. Preuve : test (service, faux agent) ; contrôle négatif : un message retiré de la file ne part pas.
- **SGS-42** Un message en file peut être retiré tant qu'il n'est pas parti. Preuve : test ; contrôle négatif : retirer un message déjà parti est refusé.
- **SGS-43** La conversation affiche aussitôt un message mis en file comme « en attente », avec « Retirer ». Preuve : aucune ; tu le regardes à la recette.

## Hors périmètre

- La remise d'un message à l'agent **dans le tour en cours** : l'app lance `claude -p` un tour à la fois ; le plan note ce que demanderait cette remise (Agent SDK ou `--input-format stream-json`), qui sera proposée à part si elle demande une dépendance ou un changement du contrat des agents. Ici, la remise se fait à la fin du tour, comme le parcours l'accepte.
- Le lieu « À traiter », la barre d'état, Ctrl+K et les autres écarts avec la maquette.
- Le cœur du kit (`next.ts`, `merge.ts`, `acceptance.ts`, `ledger.ts`…) : l'étape vient de `spawn next` tel qu'il est ; si une exigence demandait de le changer, la story s'arrête et le dit.
