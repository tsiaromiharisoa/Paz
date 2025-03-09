const fs = require('fs-extra');
const path = require('path');
const axios = require('axios');

// État pour suivre le processus de création de commande
const userCreateStates = {};

// Fonction principale pour gérer les messages dans le flux maker
async function handleMakerMessage(senderId, message, sendMessage) {
    try {
        // Initialiser l'état si nécessaire
        if (!userCreateStates[senderId]) {
            // Vérifier si le message contient déjà une URL
            const urlMatch = message.match(/(https?:\/\/[^\s]+)/);
            const initialApiUrl = urlMatch ? urlMatch[0] : '';

            userCreateStates[senderId] = {
                step: 'start',
                commandName: '',
                apiUrl: initialApiUrl,
                variableNames: []
            };

            // Si une URL est déjà détectée, passer directement à la demande du nom de commande
            if (initialApiUrl) {
                await sendMessage(senderId, `URL d'API détectée: ${initialApiUrl}\nQuelle commande souhaitez-vous créer?`);
            } else {
                await sendMessage(senderId, "Bienvenue dans l'assistant de création de commande! Quelle commande souhaitez-vous créer?");
            }
            return;
        }

        const state = userCreateStates[senderId];

        // Étape 1: Obtenir le nom de la commande
        if (state.step === 'start') {
            const commandName = message.trim().toLowerCase();

            if (!commandName || commandName === '') {
                await sendMessage(senderId, "Veuillez entrer un nom valide pour votre commande.");
                return;
            }

            // Vérifier que le nom est valide
            if (!/^[a-z0-9-]+$/.test(commandName)) {
                await sendMessage(senderId, "Le nom de commande n'est pas valide. Utilisez uniquement des lettres minuscules, des chiffres ou des tirets, sans espaces.");
                return;
            }

            // Vérifier si la commande existe déjà
            const commandPath = path.join(__dirname, '..', 'commands', `${commandName}.js`);
            if (fs.existsSync(commandPath)) {
                await sendMessage(senderId, `Une commande nommée "${commandName}" existe déjà. Veuillez choisir un autre nom.`);
                return;
            }

            state.commandName = commandName;
            state.step = 'api_url';
            // Vérifier si l'URL a déjà été fournie
            if (!state.apiUrl) {
                await sendMessage(senderId, `Donnez-moi l'URL de l'API pour construire la commande "${commandName}"`);
            } else {
                // Passer directement à l'étape de test API
                state.step = 'test_api';
                handleMakerMessage(senderId, state.apiUrl, sendMessage)
            }
        }
        // Étape 2: Obtenir l'URL de l'API (ou passer au test si déjà fournie)
        else if (state.step === 'api_url') {
            const apiUrl = message.trim();

            if (!apiUrl.startsWith('http://') && !apiUrl.startsWith('https://')) {
                await sendMessage(senderId, "Veuillez fournir une URL valide commençant par http:// ou https://");
                return;
            }

            state.apiUrl = apiUrl;
            state.step = 'test_api';
            handleMakerMessage(senderId, state.apiUrl, sendMessage);
        } else if (state.step === 'test_api') {
            // Tester l'API pour détecter les variables
            try {
                await sendMessage(senderId, "🔄 Analyse de l'API en cours...");

                // Analyser l'URL pour extraire les paramètres potentiels
                const urlObj = new URL(state.apiUrl);
                const params = urlObj.searchParams;
                const detectedVariables = [];

                for (const [key, value] of params.entries()) {
                    detectedVariables.push({
                        name: key,
                        example: value
                    });
                }

                if (detectedVariables.length > 0) {
                    state.variableNames = detectedVariables;
                    let variablesMessage = "J'ai détecté les variables suivantes dans l'URL :\n";

                    detectedVariables.forEach((variable, index) => {
                        variablesMessage += `${index + 1}. ${variable.name} (exemple: ${variable.example})\n`;
                    });

                    variablesMessage += "\nJe vais utiliser ces variables pour construire la commande.";
                    await sendMessage(senderId, variablesMessage);
                }

                // Tester l'API avec les paramètres existants
                const response = await axios.get(state.apiUrl);

                if (response.status === 200) {
                    // Créer le fichier de commande
                    await createCommandFile(state, response.data);

                    // Informer l'utilisateur et réinitialiser l'état
                    await sendMessage(senderId, `✅ La commande "${state.commandName}" a été créée avec succès dans le répertoire "commands"!\n\nVous pouvez maintenant l'utiliser en envoyant: ${state.commandName} <votre message>\n\nLe bot devra être redémarré pour que la nouvelle commande soit chargée. Utilisez la commande "restart" pour cela.`);
                    delete userCreateStates[senderId];
                } else {
                    await sendMessage(senderId, "❌ L'API semble ne pas répondre correctement. Veuillez vérifier l'URL et réessayer.");
                    delete userCreateStates[senderId];
                }
            } catch (error) {
                console.error("Erreur lors du test de l'API:", error);
                await sendMessage(senderId, "❌ Une erreur s'est produite lors du test de l'API. Veuillez vérifier l'URL et réessayer.");
                delete userCreateStates[senderId];
            }
        }
    } catch (error) {
        console.error("Erreur dans handleMakerMessage:", error);
        await sendMessage(senderId, "❌ Une erreur inattendue s'est produite. Veuillez réessayer plus tard.");
        delete userCreateStates[senderId];
    }
}

// Fonction pour créer le fichier de commande
async function createCommandFile(state, testResponse) {
    try {
        // Analyser la réponse pour comprendre sa structure
        let responseStructure = '';

        if (typeof testResponse === 'object') {
            // Extraire les clés de la réponse JSON
            const keys = Object.keys(testResponse);
            responseStructure = `// Structure de réponse: ${keys.join(', ')}`;
        }

        // Créer le contenu du fichier de commande
        let commandContent = `
const axios = require('axios');
const sendMessage = require('../handles/sendMessage');

${responseStructure}

module.exports = async (senderId, prompt) => {
    try {
        // Vérifier si l'utilisateur a fourni un texte
        if (!prompt || prompt.trim() === '') {
            await sendMessage(senderId, "Veuillez fournir un texte après la commande. Par exemple: ${state.commandName} votre_texte");
            return;
        }

        // Envoyer un message d'attente
        await sendMessage(senderId, "🔄 Traitement de votre demande en cours...");

        // Construire l'URL avec les paramètres
        let apiUrl = '${state.apiUrl}';
`;

        // Remplacer les paramètres dans l'URL si des variables ont été détectées
        if (state.variableNames.length > 0) {
            commandContent += `
        // Remplacer les paramètres dans l'URL par la valeur fournie par l'utilisateur
`;

            state.variableNames.forEach(variable => {
                const placeholder = `${variable.name}=${encodeURIComponent(variable.example)}`;
                commandContent += `        apiUrl = apiUrl.replace('${placeholder}', '${variable.name}=' + encodeURIComponent(prompt.trim()));\n`;
            });
        } else {
            // Si aucune variable n'est détectée, ajouter la requête comme paramètre générique
            commandContent += `
        // Ajouter la requête comme paramètre query
        if (!apiUrl.includes('?')) {
            apiUrl += '?query=' + encodeURIComponent(prompt.trim());
        } else {
            apiUrl += '&query=' + encodeURIComponent(prompt.trim());
        }
`;
        }

        // Ajouter le reste du code pour l'appel API
        commandContent += `
        // Appel à l'API
        const response = await axios.get(apiUrl);
        const data = response.data;

        // Formater la réponse en fonction de la structure
        let formattedResponse = '';

        if (typeof data === 'string') {
            formattedResponse = data;
        } else if (typeof data === 'object') {
`;

        // Analyser et extraire les clés de la réponse pour les afficher
        if (typeof testResponse === 'object') {
            const keys = Object.keys(testResponse);

            // Exclure les clés techniques comme "status"
            const displayKeys = keys.filter(key => !['status', 'code', 'success'].includes(key));

            if (displayKeys.length > 0) {
                commandContent += `            // Extraire les informations pertinentes
            formattedResponse = \`📊 • 𝗥𝗲́𝘀𝘂𝗹𝘁𝗮𝘁𝘀\n━━━━━━━━━━━━━━\n\`;
`;

                displayKeys.forEach(key => {
                    commandContent += `            if (data.${key}) formattedResponse += \`${key}: \${data.${key}}\n\`;\n`;
                });

                commandContent += `            formattedResponse += \`━━━━━━━━━━━━━━\`;\n`;
            } else {
                commandContent += `            // Convertir la réponse JSON en texte lisible
            formattedResponse = JSON.stringify(data, null, 2);\n`;
            }
        } else {
            commandContent += `            // Convertir la réponse JSON en texte lisible
            formattedResponse = JSON.stringify(data, null, 2);\n`;
        }

        // Finaliser le contenu du fichier
        commandContent += `        }

        await sendMessage(senderId, formattedResponse);
    } catch (error) {
        console.error('Erreur lors de la requête à l\\'API:', error);
        await sendMessage(senderId, "Désolé, une erreur s'est produite lors de la communication avec l'API. Veuillez réessayer plus tard.");
    }
};

// Ajouter les informations de la commande
module.exports.info = {
    name: "${state.commandName}",  // Le nom de la commande
    description: "Interagit avec l'API ${state.commandName}",  // Description de la commande
    usage: "Envoyez '${state.commandName} votre_texte' pour obtenir une réponse"  // Comment utiliser la commande
};
`;

        // Créer le fichier
        const commandPath = path.join(__dirname, '..', 'commands', `${state.commandName}.js`);
        await fs.writeFile(commandPath, commandContent.trim());
        console.log(`Commande ${state.commandName} créée avec succès`);

        return true;
    } catch (error) {
        console.error("Erreur lors de la création du fichier de commande:", error);
        throw error;
    }
}

module.exports = {
    handleMakerMessage,
    userCreateStates
};