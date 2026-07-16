# IUI Routines

**IUI Routines** est un gestionnaire d'automatisation (Si/Alors) natif pour Linux et GNOME, développé dans le cadre de l'écosystème [Projet PRISM](https://projet-prism.fr/).

L'application permet de déclencher des actions système automatiquement en fonction de conditions précises (batterie, réseau, heure, lancement de logiciels, etc.).

## Fonctionnalités

* **Interface GTK4 Moderne :** Éditeur visuel ergonomique s'intégrant parfaitement aux standards de GNOME.
* **Moteur Silencieux (Daemon) :** Exécution en arrière-plan sans interface graphique pour une consommation de ressources minimale.
* **Installation Automatique :** Génération automatique du fichier `.desktop` d'autostart au premier lancement.
* **Rechargement à chaud :** Le Daemon détecte les modifications des règles et se met à jour instantanément sans redémarrage.

### Déclencheurs (SI)

* Heure spécifique ou plage horaire
* Connexion à un réseau Wi-Fi spécifique
* Connexion d'un appareil Bluetooth
* Niveau de batterie critique
* Ouverture d'un logiciel spécifique
* Réception d'une notification contenant un mot-clé
* Lecture de médias (Musique/Vidéo)

### Actions (ALORS)

* Lancer ou forcer la fermeture d'un logiciel
* Activer le mode économie d'énergie
* Gérer la musique (Lecture/Pause, Suivant)
* Définir la luminosité de l'écran
* Activer le mode "Ne pas déranger"
* Déployer le clavier virtuel (Tactile)

---

## Prérequis

Le script est conçu pour les environnements GNOME utilisant **GJS** (GNOME JavaScript). Certaines conditions et actions nécessitent des paquets Linux standards :

```bash
sudo apt install gjs playerctl wireless-tools

```

* `playerctl` : Nécessaire pour le contrôle des médias (Pause/Suivant).
* `wireless-tools` : Fournit `iwgetid` pour la détection du réseau Wi-Fi actuel.

---

## Utilisation

### 1. Rendre le script exécutable

Clonez le dépôt et donnez les droits d'exécution au fichier :

```bash
chmod +x prism-routines.js

```

### 2. Mode Interface Graphique (Éditeur)

Lancez simplement le fichier. Au premier lancement, l'application s'ajoutera automatiquement au démarrage du système (`~/.config/autostart/`).

```bash
./prism-routines.js

```

### 3. Mode Daemon (Arrière-plan)

Pour tester le moteur en direct ou voir les logs d'exécution dans votre terminal, utilisez la variable d'environnement `PRISM_MODE` :

```bash
PRISM_MODE=daemon ./prism-routines.js

```

---

## Architecture Technique

Ce projet utilise un système de **multiplexage par variable d'environnement**.
Le fichier `prism-routines.js` adapte son comportement selon la manière dont il est appelé :

1. **UI Mode (Défaut) :** Initialise une boucle GTK4, lit et écrit dans `~/.config/prism-routines.json`.
2. **Daemon Mode (`PRISM_MODE=daemon`) :** Bypasse GTK4, s'abonne aux signaux DBus (Notifications, Luminosité), UPowerGlib (Batterie), et scrute les processus système via `GLib.timeout_add_seconds`.

---
