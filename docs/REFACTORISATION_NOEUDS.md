# Refactorisation après V1 : nœuds exécutables et graphes fournis par l'hôte

État au 8 septembre 2026. Cette modification succède au commit V1
`da8f9f5`. Le [bilan V1](ETAT_DES_LIEUX_V1.md) reste un document historique,
inchangé. La mémoire contextuelle V2 n'est pas implémentée ici.

## Ce qui a changé

Le runtime ne traduit plus un nom d'étape en comportement dans un
`runStage()`. Chaque classe de nœud hérite de `HarnessNode` et surcharge
`execute(input, session)`. La méthode commune `fireAsync` assure seulement
l'enveloppe d'exécution : consommation du paquet, suivi, annulation et publication.

La bibliothèque ne choisit aucun scénario ni aucun graphe par défaut.
L'hôte fournit un driver à la construction du runtime ou à chaque appel de
`step`. Sans driver, l'appel échoue avant observation ou action.

| Responsabilité | Emplacement |
| --- | --- |
| Construction et câblage du flux | `RuntimeGraphBuilder` de core, utilisé par `compileHarnessGraph` |
| Ordonnancement et exécution du graphe | `RuntimeGraph` et son ordonnanceur dans core |
| Comportement de chaque nœud | `packages/harness/src/nodes.ts` |
| Durée de vie d'une décision | `packages/harness/src/runtime.ts` |
| Services, paquets et trace propres à une décision | `packages/harness/src/session.ts` |
| Autorisation liée à la proposition réellement exécutée | `packages/harness/src/authorization.ts` |
| Enregistrement des classes dans l'éditeur | `packages/plugin-harness/src/index.ts` |
| Scénario Counter et choix de sa cible | `examples/counter/harness.mjs` |
| Topologie illustrative partagée par les exemples | `examples/shared/policy-flow.mjs` |

`HarnessGraph` est un alias de type du graphe de core, pas une nouvelle
implémentation. Le conteneur de la mémoire est également construit par le
`GraphBuilder` de core. Ses ajouts dynamiques et ses règles d'apprentissage
restent ceux de V1.

## Deux façons de fournir un graphe

Un document de l'éditeur est compilé avec
`createGraphDriver(definition, onNode?, factory?)`.
La compilation utilise `RuntimeGraphBuilder.withNodes`, `withChannel` et
`build`, puis valide les contraintes du harnais.

Un hôte qui construit déjà ses nœuds avec le builder de core peut transmettre
le résultat directement à `createRuntimeGraphDriver(graph, onNode?)`.
Il n'a pas à passer par JSON. Les deux chemins partagent la même validation
et la même exécution.

Le driver peut être injecté avec
`new AdaptivePolicyRuntime({ ...services, driver })`, puis
`runtime.step(intention)`. Il peut aussi être fourni à l'appel :
`runtime.step(intention, signal, driver)`.
L'intention utilisée pour décider est celle passée à `step`.

Counter n'est importé que par ses consommateurs dans les exemples et les tests.
HELIOS choisit sa propre intention et réutilise la topologie illustrative,
sans importer Counter. L'éditeur compile le graphe visible avant l'exécution.

## Exemple de surcharge

Ce nœud force le recours au raisonneur. Il illustre une spécialisation,
sans modifier le comportement par défaut de la bibliothèque :

```ts
import {
    PolicyLookupNode,
    type DecisionContext,
    type HarnessSession,
    type NodeEmission,
} from "@spiky-panda/harness";

class AlwaysReasonLookup extends PolicyLookupNode {
    protected override async execute(
        context: DecisionContext,
        _session: HarnessSession,
    ): Promise<NodeEmission> {
        return {
            slot: "candidates",
            value: { context, candidates: [] },
        };
    }
}
```

Pour un document JSON, la factory de l'hôte remplace le type voulu par
`new AlwaysReasonLookup()` et délègue les autres à `createHarnessNode(type)`.
Pour un graphe construit en code, le builder de core expose déjà
`replaceNode(current, replacement)`, qui recâble ses liens. Copier l'identifiant
et le type sur le nouveau nœud permet de conserver ceux du document.

Les factories sont du code de confiance. Elles doivent renvoyer de nouvelles
instances et éviter les effets de bord : la validation des documents peut
elle aussi construire des nœuds. Les fonctions ne sont jamais sérialisées.

Les nœuds ne doivent pas conserver les données d'une décision dans leur
`bag` ni dans un champ d'instance. Une instance de graphe peut être partagée
entre runtimes ; chaque décision possède sa propre `HarnessSession`.

## Ce qui reste contrôlé

Les ports sont typés, les paquets liés à leur session et consommables une seule
fois. Le nœud de sécurité demande à `ExecutionAuthority` une autorisation
portant sur la proposition validée. Le nœud d'exécution consomme ce reçu.

Cette autorité applique le garde-fou de l'hôte. Le registre conserve les
permissions, l'approbation fraîche, les contrôles de disponibilité et de
fraîcheur de l'observation. Une décision ne peut déclencher qu'une action.
Le nœud d'apprentissage vérifie que le résultat appartient à l'exécution
réellement terminée avant d'enregistrer une expérience.

Il n'y a plus de liste centrale imposant douze étapes dans un ordre codé
à la main. La validation conserve une source d'observation, un puits
d'expérience, des ports complètement câblés et un graphe acyclique.
Les extensions de source et de puits héritent des classes correspondantes.
Les boucles, canaux retardés et actions parallèles ne sont pas pris en charge.

La petite adaptation de `HarnessSession.publish` pour le parcours asynchrone
du core est conservée. Elle distribue les messages de sa file avec les API
publiques du core ; elle ne remplace ni son builder ni son ordonnanceur.

Ces contrôles ne constituent pas une isolation contre du JavaScript hostile
dans le même processus, ni une transaction atomique avec un actionneur distant.

## Compatibilité et migration

Les documents JSON de la V1 consolidée gardent leur version, leurs identifiants
de nœuds et leurs ports. Les règles de plasticité et les statistiques apprises
ne sont pas converties.

Les API internes `runStage`, `selectedSource`, `HarnessNodeServices` et le
`headlessDriver` implicite sont supprimés. Les consommateurs doivent utiliser
les nœuds et un driver explicite. `createCounterHarness` n'est plus exporté
par la bibliothèque ni par le plugin ; il appartient à l'exemple Counter.
`PolicyGraph.graphView()` expose désormais l'interface `IGraph` de core.

Le plugin visuel ne contient pas sa propre copie des classes du harnais.
Avant son chargement, l'hôte expose `globalThis.SpikypandaHarness`, lié au
même core que l'éditeur. La démo effectue cette liaison. Il faut reconstruire
ensemble l'application et le plugin avec `npm run build:demo`.

## Vérifications

- Comparaison exacte avec la trace V1 de 36 actions et deux inversions,
  hors identifiants et horodatages non déterministes.
- Surcharge d'un nœud et insertion d'un treizième nœud sans modifier le runtime.
- Remplacement d'un nœud par le builder de core et exécution sans sérialisation.
- Absence de scénario implicite dans la bibliothèque.
- Sessions concurrentes indépendantes, refus des paquets et reçus réutilisés.
- Refus des cycles, exécutions fictives et résultats substitués.
- Chargement du plugin avec les classes partagées du core et du harnais.
- Counter : 20 épisodes atteignent la cible, y compris après deux inversions.

La démo a été vérifiée par apprentissage temporaire, inversion et retour à la
mémoire précédemment sauvegardée, sans réécrire cette sauvegarde.
Le port fixe 4175 et le lanceur restent inchangés.

Cette refactorisation prépare l'extension du harnais. Elle ne résout pas encore
la séparation entre fiabilité acquise et applicabilité à un contexte de
fonctionnement, qui demeure le sujet de la V2.
