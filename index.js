// See https://github.com/dialogflow/dialogflow-fulfillment-nodejs
// for Dialogflow fulfillment library docs, samples, and to report issues
'use strict';

const axios = require('axios');
const functions = require('firebase-functions');
const {WebhookClient, Suggestion} = require('dialogflow-fulfillment');
const {Carousel, List, Suggestions} = require('actions-on-google');

process.env.DEBUG = 'dialogflow:debug'; // enables lib debugging statements
 
exports.dialogflowFirebaseFulfillment = functions.https.onRequest((request, response) => {

  const agent = new WebhookClient({ request, response });
  let intentMap = new Map();

  let token = request.body.originalDetectIntentRequest.payload.user.accessToken;
  axios.defaults.baseURL = 'https://api.keeping.nl/v1/';
  axios.defaults.headers.common = {'Authorization': `Bearer ${token}`}

  
  
  async function getOrganisation(conv, agent)
  {

    try {
        const responseToOrganisationsRequest = await axios.get('organisations');
        const organisations = responseToOrganisationsRequest.data.organisations;
        
        // Handle cases of single and zero organisations
        if (organisations.length == 0) {
            conv.ask(`Sorry er is iets fout gegaan. Ik kon geen enekele Keeping-organisatie ophalen. Misschien moet je er eerst een aanmaken.`);
        } else if (organisations.length == 1) {
          return organisations[0];
        }

        // Check if an organisationId has been set
        let organisationId = null;
        if (typeof conv.data.organiastionId !== 'undefined') {
          organisationId = conv.data.organiastionId;
        } else if (conv.user.verification === 'VERIFIED' &&  typeof conv.user.storage.organiastionId !== 'undefined') {
            conv.data.organiastionId = conv.user.storage.organiastionId;
            organisationId = conv.user.storage.organiastionId;
        }

        // Select organisation with organisationId
        if (organisationId !== null) {
          let organisation = organisations.find(o => o.id === organisationId);
          if (organisation !== null) {
            return organisation;
          }
        }
        
        // Ask to select an organisation
        conv.ask(`Eerst moet ik weten met welke Keeping-organisatie je wilt werken.`);
        conv.ask(new List({
          title: 'Kies een Keeping-organisatie:',
          items: organisations.reduce((a, organisation) => (a[`organisation_${organisation.id}`] = {
              title: organisation.name
          }, a), {})
        }));
        conv.contexts.set('OrganisationSelection', 1);

    } catch (error) {
        console.error(error);
        conv.close(`Sorry er is iets fout gegaan. Ik kon de Keeping-organisaties niet ophalen.`);
    }

    agent.add(conv);
    return null;
  }



  async function selectOrganisation(agent)
  {
    let conv = agent.conv();

    try {
      const responseToOrganisationsRequest = await axios.get('organisations');

      const organisations = responseToOrganisationsRequest.data.organisations
        .reduce((a, organisation) => (a[`organisation_${organisation.id}`] = organisation, a), {});

      const organisation = organisations[conv.arguments.get('OPTION')];

      conv.data.organiastionId = organisation.id;
      if (conv.user.verification === 'VERIFIED') {
        conv.user.storage.organiastionId = organisation.id;
      }

      conv.ask(new Suggestions([`Ik begin`, `Ik ben klaar`, `Nu even pauze`]));

      conv.ask(`Ik kan nu je tijdregistraties bij ${organisation.name} bijwerken.`);

      conv.contexts.delete('OrganisationSelection');

    } catch (error) {
        console.error(error);
        conv.close(`Sorry er is iets fout gegaan. Ik kon deze Keeping-organisatie niet selecteren.`);
    }

    agent.add(conv);
  }
  intentMap.set('SelectOrganisation', selectOrganisation);

  async function startWorkTimer(agent) {

    let conv = agent.conv();

    let organisation = await getOrganisation(conv, agent);
    if (organisation === null) {
        return;
    }

    let last = null;

    try {
      const response = await axios.get(`${organisation.id}/time-entries/last?purpose=work&locked=0`);
      last = response.data.time_entry;
    } catch (error) {
      console.error(error);
      conv.close(`Sorry er is iets fout gegaan. Ik kon je laatste tijdregistratie niet ophalen.`);
      agent.add(conv);
      return;
    }

    if (last.ongoing === false) {

      try {
        const response = await axios.post(`${organisation.id}/time-entries/${last.id}/resume`);
        const resumed = response.data.time_entry;
      } catch (error) {
        console.error(error);
        conv.close(`Sorry er is iets fout gegaan. Ik kon je laatste tijdregistratie niet hervatten.`);
        agent.add(conv);
        return;
      }

      conv.close(`Je laatste tijdregistratie is hervat.`);

    } else {
      conv.close(`Mooi, ik hoef niets te doen. Je hebt al een lopende tijdregistratie.`);
    }

    agent.add(conv);
  }
  intentMap.set('StartWorkTimer', startWorkTimer);



  async function startBreakTimer(agent) {

    let conv = agent.conv();

    let organisation = await getOrganisation(conv, agent);
    if (organisation === null) {
        return;
    }

    if (organisation.features.breaks !== true) {
      conv.close(`Pauzes zijn niet ingeschakeld voor ${organisation.name}. Voordat je gebruik kan maken van deze functie moet een beheerder pauzes aanzetten in de organisatie-instellingen op Keeping.nl.`);
      agent.add(conv);
      return;
    }

    let last = null;

    try {
      const response = await axios.get(`${organisation.id}/time-entries/last?purpose=break&locked=0`);
      last = response.data.time_entry;
    } catch (error) {
      console.error(error);
      conv.close(`Sorry er is iets fout gegaan. Ik kon je laatste pauze niet ophalen.`);
      agent.add(conv);
      return;
    }

    if (last.ongoing === false) {

      try {
        const response = await axios.post(`${organisation.id}/time-entries/${last.id}/resume`);
        const resumed = response.data.time_entry;
      } catch (error) {
        console.error(error);
        conv.close(`Sorry er is iets fout gegaan. Ik kon je pauze niet hervatten.`);
        agent.add(conv);
        return;
      }

      conv.close(`Je kan nu pauze nemen.`);

    } else {
      conv.close(`Mooi, ik hoef niets te doen. Je hebt al een lopende pauzeregistratie.`);
    }

    agent.add(conv);
  }
  intentMap.set('StartBreakTimer', startBreakTimer);



  async function stopWorkTimer(agent) {

    let conv = agent.conv();

    let organisation = await getOrganisation(conv, agent);
    if (organisation === null) {
        return;
    }

    let last = null;

    try {
      const response = await axios.get(`${organisation.id}/time-entries/last?purpose=work&ongoing=1`);
      last = response.data.time_entry;
    } catch (error) {
      if (!(error.response && error.response.status == 404)) {
        console.error(error);
        conv.close(`Sorry er is iets fout gegaan. Ik kon je lopende tijdregistratie niet ophalen.`);
        agent.add(conv);
        return;
      }
    }

    if (last !== null && last.ongoing === true) {

      try {
        const response = await axios.patch(`${organisation.id}/time-entries/${last.id}/stop`);
        const stopped = response.data.time_entry;
      } catch (error) {
        console.error(error);
        conv.close(`Sorry er is iets fout gegaan. Ik kon je laatste tijdregistratie niet hervatten.`);
        agent.add(conv);
        return;
      }

      conv.close(`Je tijdregistratie is gestopt.`);

    } else {
      conv.close(`Mooi, ik hoef niets te doen. Je hebt geen lopende tijdregistratie.`);
    }

    agent.add(conv);
  }
  intentMap.set('StopWorkTimer', stopWorkTimer);



  async function welcome(agent)
  {
    let conv = agent.conv();

    if (conv.user.verification === 'VERIFIED' && typeof conv.user.storage.introduced !== 'undefined' && conv.user.storage.introduced === true) {
      conv.ask(
        `Hoi, kan ik je helpen met jouw tijdregistraties?` 
      );  
    } else {

      if (conv.user.verification === 'VERIFIED') {
        conv.user.storage.introduced = true;
      }

      conv.ask(
        `Hoi, je praat met Keeping. ` + 
        `Je kan mij vertellen dat je bent gestart, of bent gestopt met werken. ` + 
        `Ik zal er dan voor zorgen dat jouw tijdregistraties goed worden bijgewerkt.`
      );
    }

    let organisation = await getOrganisation(conv, agent);
    if (organisation === null) {
        return;
    }
    
    conv.ask(new Suggestions([`Ik begin`, `Ik ben klaar`, `Nu even pauze`]));

    agent.add(conv);
  }
  intentMap.set('Welcome', welcome);



  async function fallback(agent)
  {
    let conv = agent.conv();

    conv.ask(`Sorry ik begrijp je niet. Je kan mij vragen naar je tijdregistraties bij Keeping.`);

    conv.ask(new Suggestions([`Ik begin`, `Ik ben klaar`, `Nu even pauze`]));

    agent.add(conv);
  }
  intentMap.set('Fallback', fallback);


  
  agent.handleRequest(intentMap);
});
