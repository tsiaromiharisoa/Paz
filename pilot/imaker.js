
const fs = require('fs-extra');
const path = require('path');
const axios = require('axios');
const url = require('url');

// État de création pour chaque utilisateur
const userCreateStates = {};

// Fonction principale pour gérer les messages entrants pour imaker
async function handleImakerMessage(senderId, message, sendMessageFunc) {
    // Si c'est la première interaction avec imaker
    if (!userCreateStates[senderId]) {
        userCreateStates[senderId] = {
            step: 'start',
            commandName: '',
            apiUrl: '',
            promptParam: '',
            imageParam: '',
            uidParam: ''
        };
        await sendMessageFunc(senderId, "La commande imaker est activée. Cette commande vous permettra de créer une nouvelle commande qui utilise des images.\n\nQuel est le nom de la commande à créer ?");
        return;
    }

    const state = userCreateStates[senderId];

    // Traitement des différentes étapes
    switch (state.step) {
        case 'start':
            // Validation du nom de la commande
            const commandName = message.trim().toLowerCase();
            if (!commandName || /[^a-z0-9]/.test(commandName)) {
                await sendMessageFunc(senderId, "Le nom de la commande doit contenir uniquement des lettres minuscules et des chiffres. Veuillez réessayer:");
                return;
            }

            // Vérifier si la commande existe déjà
            const commandsDir = path.join(__dirname, '../commands');
            const routersDir = path.join(__dirname, '../routers');
            
            if ((fs.existsSync(path.join(commandsDir, `${commandName}.js`))) || 
                (fs.existsSync(routersDir) && fs.existsSync(path.join(routersDir, `${commandName}.js`)))) {
                await sendMessageFunc(senderId, `La commande "${commandName}" existe déjà. Veuillez choisir un autre nom:`);
                return;
            }

            state.commandName = commandName;
            state.step = 'api_url';
            await sendMessageFunc(senderId, `Création du nom "${commandName}" avec succès.\nDonnez-moi l'API URL à inclure dans la commande, qui doit contenir les paramètres prompt, uid et image:`);
            break;

        case 'api_url':
            const apiUrl = message.trim();
            
            if (!apiUrl.startsWith('http')) {
                await sendMessageFunc(senderId, "L'URL doit commencer par http:// ou https://. Veuillez réessayer:");
                return;
            }

            try {
                // Vérifier si l'URL est répétée (une erreur courante)
                if (apiUrl.includes('https://') && apiUrl.lastIndexOf('https://') > 0) {
                    const firstHttpsIndex = apiUrl.indexOf('https://');
                    apiUrl = apiUrl.substring(0, apiUrl.lastIndexOf('https://'));
                    await sendMessageFunc(senderId, "J'ai détecté une URL répétée et j'ai corrigé le format.");
                }
                
                // Analyser l'URL pour extraire les paramètres
                const parsedUrl = new URL(apiUrl);
                const params = new URLSearchParams(parsedUrl.search);
                
                // Extraire et stocker les noms des paramètres
                let foundPrompt = false;
                let foundUid = false;
                let foundImage = false;

                for (const [key, value] of params.entries()) {
                    if (key.toLowerCase().includes('prompt')) {
                        state.promptParam = key;
                        foundPrompt = true;
                    }
                    if (key.toLowerCase().includes('uid') || key.toLowerCase().includes('id')) {
                        state.uidParam = key;
                        foundUid = true;
                    }
                    if (key.toLowerCase().includes('image')) {
                        state.imageParam = key;
                        foundImage = true;
                    }
                }

                if (!foundPrompt || !foundUid || !foundImage) {
                    await sendMessageFunc(senderId, "L'URL doit contenir des paramètres pour 'prompt', 'uid' et 'image'. Veuillez fournir une URL valide:");
                    return;
                }

                state.apiUrl = apiUrl;
                state.step = 'finished';
                
                // Créer le fichier de commande
                await createCommandFile(state);
                
                await sendMessageFunc(senderId, `Merci ! Je vais créer votre commande "${state.commandName}" et l'ajouter dans le répertoire routers.`);
                await sendMessageFunc(senderId, `Création de la commande "${state.commandName}" terminée avec succès ! Vous pouvez maintenant l'utiliser en envoyant "${state.commandName}" suivi d'une question, ou en envoyant une image.`);
                
                // Réinitialiser l'état
                delete userCreateStates[senderId];
            } catch (error) {
                console.error('Erreur lors de l\'analyse de l\'URL:', error);
                await sendMessageFunc(senderId, "L'URL fournie n'est pas valide. Veuillez réessayer avec une URL correcte:");
            }
            break;
    }
}

// Fonction pour créer le fichier de commande
async function createCommandFile(state) {
    try {
        // Extraire la base de l'URL sans les paramètres
        const apiUrlBase = state.apiUrl.split('?')[0];
        
        // Créer le répertoire routers s'il n'existe pas
        const routersDir = path.join(__dirname, '../routers');
        await fs.ensureDir(routersDir);
        
        // Créer le contenu du fichier
        const fileContent = `const sendMessage = require('../handles/sendMessage');
const axios = require('axios');
const fs = require('fs-extra');
const path = require('path');

// État pour stocker les images temporaires
const tempImageStates = {};

module.exports = async (senderId, prompt, attachments = []) => {
    try {
        // Vérifier si un message de début est nécessaire
        if (!prompt && !attachments.length) {
            await sendMessage(senderId, "La commande ${state.commandName} est activée. Envoyez une image avec une description ou posez une question.");
            return;
        }

        // Gérer les pièces jointes d'images
        let imageUrl = '';
        if (attachments && attachments.length > 0) {
            const imageAttachments = attachments.filter(att => att.type === 'image');
            if (imageAttachments.length > 0) {
                imageUrl = imageAttachments[0].payload.url;
                
                // Si l'utilisateur a envoyé une image sans prompt
                if (!prompt) {
                    tempImageStates[senderId] = imageUrl;
                    await sendMessage(senderId, "Image reçue. Veuillez maintenant envoyer une description ou une question concernant cette image.");
                    return;
                }
            }
        }

        // Vérifier s'il y a une image en attente
        if (!imageUrl && tempImageStates[senderId] && prompt) {
            imageUrl = tempImageStates[senderId];
            delete tempImageStates[senderId]; // Nettoyer après utilisation
        }

        // Préparer l'appel API
        let apiUrl = '${apiUrlBase}?';
        
        // Ajouter les paramètres
        apiUrl += \`${state.promptParam}=\${encodeURIComponent(prompt)}\`;
        
        // Ajouter l'ID utilisateur
        apiUrl += \`&${state.uidParam}=\${senderId}\`;
        
        // Ajouter l'URL de l'image si présente
        if (imageUrl) {
            apiUrl += \`&${state.imageParam}=\${encodeURIComponent(imageUrl)}\`;
        }

        // Informer l'utilisateur que la requête est en cours
        await sendMessage(senderId, "Traitement de votre demande en cours...");

        // Appeler l'API
        const response = await axios.get(apiUrl);
        
        // Vérifier si la réponse contient les données attendues
        if (response.data && response.data.response) {
            await sendMessage(senderId, response.data.response);
        } else {
            await sendMessage(senderId, "Désolé, je n'ai pas pu obtenir une réponse valide de l'API.");
        }
    } catch (error) {
        console.error('Erreur lors de l\\'exécution de la commande ${state.commandName}:', error);
        await sendMessage(senderId, "Désolé, une erreur s'est produite lors du traitement de votre demande.");
    }
};

// Ajouter les informations de la commande
module.exports.info = {
    name: "${state.commandName}",
    description: "Commande interactive avec support d'images pour ${state.commandName}.",
    usage: "Envoyez '${state.commandName}' suivi d'une question ou envoyez une image avec une description."
};
`;

        // Écrire le fichier
        await fs.writeFile(path.join(routersDir, `${state.commandName}.js`), fileContent);
        console.log(`Commande ${state.commandName} créée avec succès dans le répertoire routers/`);
        
        return true;
    } catch (error) {
        console.error('Erreur lors de la création du fichier de commande:', error);
        return false;
    }
}

module.exports = {
    handleImakerMessage,
    userCreateStates
};
